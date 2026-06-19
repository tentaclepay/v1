import {
	CoordinatorInnerModule,
	createUserSignMessageWithPublicOutput,
	getNetworkConfig,
	IkaClient,
	type SignWithState,
} from "@ika.xyz/sdk";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { coinWithBalance, Transaction } from "@mysten/sui/transactions";

import {
	buildPayAndSignAttestationBytes,
	createNonce,
	parseIkaHashScheme,
	parseIkaSignatureAlgorithm,
	PaymentSucceedEvent,
	Signer,
	usdcCoinType,
	verifier,
} from "./shared";

import { addresses } from "./dwallets.json";
import { module, package_id, protocol_id, signer_id } from "./state.json";

import { SUI_CLOCK_OBJECT_ID } from "@mysten/sui/utils";
import {
	buildTransferWithAuthorizationPreimage,
	ikaSignatureToEthSignature,
	type TransferWithAuthorizarionParams,
} from "./lib/evm";
import {
	baseUrl,
	network,
	parseIkaCurve,
	publisher,
	type Curve,
	type HashScheme,
	type SignatureAlgorithm,
} from "./shared";

const chainId = 84532; // Base Sepolia
const contractAddress = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const name = "USDC";
const version = "2";
const decimals = 6;

const amount = "0.05";
const amountInUnits = BigInt(Number(amount) * 10 ** decimals);

const to = "0x16D726c2052ac8FC26618A0e8dceDc03AF1F704b";

const publisherAddress = publisher.toSuiAddress();

const suiClient = new SuiGrpcClient({
	network,
	baseUrl,
});

const ikaClient = new IkaClient({
	suiClient,
	config: getNetworkConfig(network),
	cache: true,
});

await ikaClient.initialize();

const ikaCoordinator = ikaClient.ikaConfig.objects.ikaDWalletCoordinator;

const { object: signerObject } = await suiClient.getObject({
	objectId: signer_id,
	include: {
		content: true,
	},
});

const signer = Signer.parse(signerObject.content);

const dwallet = await ikaClient.getDWalletInParticularState(
	signer.dwallet_cap.dwallet_id,
	"Active",
);
if (!dwallet.public_user_secret_key_share)
	throw new Error("Invalid Shared dWallet");

const publicParameters = await ikaClient.getProtocolPublicParameters(dwallet);

const [presign] = signer.presigns;
if (!presign) throw new Error("No presigns available");

const completedPresign = await ikaClient.getPresignInParticularState(
	presign.presign_id,
	"Completed",
);

const now = Math.floor(Date.now() / 1000);
const validBefore = now + 3600;
const validBeforeMs = validBefore * 1000;

const nonce = createNonce();
const transferWithAuthorizationParams: TransferWithAuthorizarionParams = {
	chainId,
	contractAddress,
	name,
	version,
	nonce,
	from: addresses.evm,
	to,
	value: amountInUnits,
	validAfter: 0n,
	validBefore: BigInt(validBefore),
};

const message = buildTransferWithAuthorizationPreimage(
	transferWithAuthorizationParams,
);

const curve = signer.curve as Curve;
const signatureAlgorithm = signer.signature_algorithm as SignatureAlgorithm<
	typeof curve
>;
const hashScheme = signer.hash_scheme as HashScheme<
	typeof curve,
	typeof signatureAlgorithm
>;

const ikaCurve = parseIkaCurve(curve);
const ikaSignatureAlgorithm = parseIkaSignatureAlgorithm(
	curve,
	signatureAlgorithm,
);
const ikaHashScheme = parseIkaHashScheme(curve, signatureAlgorithm, hashScheme);

// Create user's partial signature
const messageCentralizedSignature = await createUserSignMessageWithPublicOutput(
	publicParameters,
	Uint8Array.from(dwallet.state.Active.public_output),
	Uint8Array.from(dwallet.public_user_secret_key_share), // shared dWallet → public share
	Uint8Array.from(completedPresign.state.Completed.presign),
	message, // the PREIMAGE
	ikaHashScheme,
	ikaSignatureAlgorithm,
	ikaCurve,
);

const attestationBytes = buildPayAndSignAttestationBytes({
	protocolId: protocol_id,
	signerId: signer_id,
	coordinatorId: ikaCoordinator.objectID,
	amount: amountInUnits,
	message,
	messageCentralizedSignature,
	validBefore: validBeforeMs,
});

const attestationSignature = await verifier.sign(attestationBytes);

const tx = new Transaction();

tx.setSender(publisherAddress);
tx.moveCall({
	package: package_id,
	module: module,
	function: "pay_and_sign",
	arguments: [
		tx.object(protocol_id),
		tx.object(signer_id),
		tx.object(ikaCoordinator.objectID),
		coinWithBalance({
			balance: amountInUnits,
			type: usdcCoinType,
		}),
		tx.pure.vector("u8", Array.from(message)),
		tx.pure.vector("u8", Array.from(messageCentralizedSignature)),
		tx.pure.vector("u8", Array.from(attestationSignature)),
		tx.pure.u64(validBeforeMs),
		tx.object(SUI_CLOCK_OBJECT_ID),
	],
});

const txBytes = await tx.build({ client: suiClient });

const result = await suiClient.signAndExecuteTransaction({
	transaction: txBytes,
	signer: publisher,
	include: {
		events: true,
	},
});

if (result.$kind === "FailedTransaction")
	throw new Error("Transaction failed!");

const paymentSucceedEvent = result.Transaction.events.find(
	(event) =>
		event.packageId === package_id &&
		event.module === module &&
		event.eventType === `${package_id}::${module}::MessageSigned`,
);
if (!paymentSucceedEvent) throw new Error("No payment success event");

const { sign_id } = PaymentSucceedEvent.parse(paymentSucceedEvent.bcs);

const completedSign = await ikaClient.getSignInParticularState(
	sign_id,
	ikaCurve,
	ikaSignatureAlgorithm,
	"Completed",
);

const { object: signObject } = await suiClient.getObject({
	objectId: completedSign.id,
	include: {
		content: true,
	},
});

const sign = CoordinatorInnerModule.SignSession.parse(
	signObject.content,
) as SignWithState<"Completed">;

const evmSignature = ikaSignatureToEthSignature(sign.state.Completed.signature);

const {
	chainId: _chainId,
	contractAddress: _contractAddress,
	version: _version,
	name: _name,
	...transferWithAuthorization
} = transferWithAuthorizationParams;

console.log({
	...transferWithAuthorization,
	signature: evmSignature,
});
