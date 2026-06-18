import {
	CoordinatorInnerModule,
	createUserSignMessageWithPublicOutput,
	Curve,
	getNetworkConfig,
	Hash,
	IkaClient,
	SignatureAlgorithm,
	type SignWithState,
} from "@ika.xyz/sdk";
import { SuiGrpcClient } from "@mysten/sui/grpc";

import { Transaction } from "@mysten/sui/transactions";
import {
	concat,
	createWalletClient,
	fromHex,
	getTypesForEIP712Domain,
	hashDomain,
	hashStruct,
	http,
	parseUnits,
	toHex,
} from "viem";
import {
	authorizationTypes,
	baseUrl,
	createNonce,
	currentSignerId,
	eip3009Abi,
	network,
	owner,
	signerBcs,
	signerEvmAddress,
	tentaclepayPackageId,
} from "./shared";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { waitForTransactionReceipt } from "viem/actions";

const chainId = 84532; // Base Sepolia
const usdcContractAddress = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const usdcName = "USDC";
const usdcVersion = "2";
const usdcDecimals = 6;

const from = signerEvmAddress;
const to = "0x16D726c2052ac8FC26618A0e8dceDc03AF1F704b" as const;
const value = parseUnits("0.03", usdcDecimals);
const timeoutSeconds = 1 * 60 * 60;

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
const ika2pcMpcOriginalPackage =
	ikaClient.ikaConfig.packages.ikaDwallet2pcMpcOriginalPackage;

const nonce = createNonce();
const now = Math.floor(Date.now() / 1000);

const domain = {
	chainId,
	name: usdcName,
	version: usdcVersion,
	verifyingContract: usdcContractAddress,
} as const;

const message = {
	from,
	to,
	value,
	validAfter: 0n,
	validBefore: BigInt(now + timeoutSeconds),
	nonce,
};

const types = {
	EIP712Domain: getTypesForEIP712Domain({ domain }),
	...authorizationTypes,
};

const transferWithAuthorizationPreimage = concat([
	"0x1901",
	hashDomain({ domain, types }),
	hashStruct({
		data: message,
		primaryType: "TransferWithAuthorization",
		types,
	}),
]);

const transferWithAuthorizationMessageBytes = fromHex(
	transferWithAuthorizationPreimage,
	"bytes",
);

const { object: signerObject } = await suiClient.getObject({
	objectId: currentSignerId,
	include: {
		content: true,
	},
});

if (!signerObject) throw new Error("Invalid signer object");

const signer = signerBcs.parse(signerObject.content);

const dwallet = await ikaClient.getDWallet(signer.dwallet_cap.dwallet_id);
if (!dwallet.public_user_secret_key_share)
	throw new Error("Not shared dWallet");
if (dwallet.state.$kind !== "Active") throw new Error("Wallet not activated");

const [presign] = signer.presigns;
if (!presign) throw new Error("No presign available");

const completedPresign = await ikaClient.getPresignInParticularState(
	presign.presign_id,
	"Completed",
);

const publicParameters = await ikaClient.getProtocolPublicParameters(dwallet);

// Create user's partial signature
const messageCentralizedSignature = await createUserSignMessageWithPublicOutput(
	publicParameters,
	Uint8Array.from(dwallet.state.Active.public_output),
	Uint8Array.from(dwallet.public_user_secret_key_share), // shared dWallet → public share
	Uint8Array.from(completedPresign.state.Completed.presign),
	transferWithAuthorizationMessageBytes, // the PREIMAGE
	Hash.KECCAK256,
	SignatureAlgorithm.ECDSASecp256k1,
	Curve.SECP256K1,
);

const tx = new Transaction();

tx.setSender(owner.toSuiAddress());
tx.moveCall({
	package: tentaclepayPackageId,
	module: "tentaclepay",
	function: "sign_message",
	arguments: [
		tx.object(currentSignerId),
		tx.object(ikaCoordinator.objectID),
		tx.pure.vector("u8", Array.from(transferWithAuthorizationMessageBytes)),
		tx.pure.vector("u8", Array.from(messageCentralizedSignature)),
	],
});

const txBytes = await tx.build({ client: suiClient });

const txResult = await suiClient.signAndExecuteTransaction({
	transaction: txBytes,
	signer: owner,
	include: {
		objectTypes: true,
	},
});

if (txResult.$kind === "FailedTransaction")
	throw new Error("Transaction failed");

const objectTypes = Object.entries(txResult.Transaction.objectTypes);
const signSession = objectTypes.find(
	([_objectId, type]) =>
		type === `${ika2pcMpcOriginalPackage}::coordinator_inner::SignSession`,
);
if (!signSession) throw new Error("SignSession not found");

const [signId] = signSession;

const completedSignature = await ikaClient.getSignInParticularState(
	signId,
	Curve.SECP256K1,
	SignatureAlgorithm.ECDSASecp256k1,
	"Completed",
);

const signatureResult = await suiClient.getObject({
	objectId: completedSignature.id,
	include: {
		content: true,
	},
});

const signatureData = CoordinatorInnerModule.SignSession.parse(
	signatureResult.object.content,
) as SignWithState<"Completed">;

function ikaSigToEthSignature(signature: number[] | Uint8Array) {
	const bytes = Uint8Array.from(signature);
	const [recoveryId] = bytes;

	const r = toHex(bytes.slice(1, 33));
	const s = toHex(bytes.slice(33, 65));
	const v = recoveryId! + 27;

	return concat([r, s, toHex(v, { size: 1 })]);
}

const evmSignature = ikaSigToEthSignature(
	signatureData.state.Completed.signature,
);

const evmBroadcasterAccount = privateKeyToAccount(
	Bun.env.EVM_BROADCASTER_PRIVATE_KEY! as `0x${string}`,
);

const walletClient = createWalletClient({
	chain: baseSepolia,
	transport: http(),
	account: evmBroadcasterAccount,
});

const hash = await walletClient.writeContract({
	abi: eip3009Abi,
	address: usdcContractAddress,
	functionName: "transferWithAuthorization",
	args: [
		message.from,
		message.to,
		message.value,
		message.validAfter,
		message.validBefore,
		message.nonce,
		evmSignature,
	],
});

const receipt = await waitForTransactionReceipt(walletClient, {
	hash,
});

console.dir(receipt, { depth: Infinity });

// await Bun.write(
// 	`./signed/signed_${now}.json`,
// 	JSON.stringify(
// 		{
// 			message,
// 			transaction: txResult,
// 		},
// 		(_, value) => {
// 			if (typeof value === "bigint") return value.toString();
// 			if (value instanceof Uint8Array) return value.toBase64();

// 			return value;
// 		},
// 		2,
// 	),
// );
