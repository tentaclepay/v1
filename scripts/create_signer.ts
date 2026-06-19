import {
	createRandomSessionIdentifier,
	getNetworkConfig,
	IkaClient,
	prepareDKGAsync,
	UserShareEncryptionKeys,
} from "@ika.xyz/sdk";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { coinWithBalance, Transaction } from "@mysten/sui/transactions";

import { package_id, module, admin_cap } from "./state.json";

import {
	baseUrl,
	ikaCoinType,
	network,
	parseIkaCurve,
	publisher,
	rootSeed,
	SignerCreatedEvent,
	type Curve,
	type HashScheme,
	type SignatureAlgorithm,
} from "./shared";

const curve: Curve = 0; // SECP256K1
const signatureAlgorithm: SignatureAlgorithm<typeof curve> = 0; // ECDSA
const hashScheme: HashScheme<typeof curve, typeof signatureAlgorithm> = 0; // Keccak256

const ikaCurve = parseIkaCurve(curve);

const initialIka = 2_000_000_000; // 2
const initialSui = 500_000_000; // 0.5

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

const networkEncryptionKey = await ikaClient.getLatestNetworkEncryptionKey();

const userShareEncryptionKeys = await UserShareEncryptionKeys.fromRootSeedKey(
	new TextEncoder().encode(rootSeed),
	ikaCurve,
);

const identifier = createRandomSessionIdentifier();

// Prepare DKG - this generates the necessary cryptographic materials
const dkgRequestInput = await prepareDKGAsync(
	ikaClient,
	ikaCurve,
	userShareEncryptionKeys,
	identifier,
	publisherAddress,
);

const tx = new Transaction();

tx.setSender(publisherAddress);
tx.moveCall({
	package: package_id,
	module: module,
	function: "create_signer",
	arguments: [
		tx.object(admin_cap),
		tx.object(ikaCoordinator.objectID),
		tx.pure.u32(curve),
		tx.pure.u32(signatureAlgorithm),
		tx.pure.u32(hashScheme),
		tx.pure.id(networkEncryptionKey.id),
		tx.pure.vector("u8", Array.from(dkgRequestInput.userDKGMessage)),
		tx.pure.vector("u8", Array.from(dkgRequestInput.userPublicOutput)),
		tx.pure.vector("u8", Array.from(dkgRequestInput.userSecretKeyShare)),
		tx.pure.vector("u8", Array.from(identifier)),
		coinWithBalance({
			balance: initialIka,
			type: ikaCoinType,
		}),
		coinWithBalance({ balance: initialSui }),
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

const signerCreatedEvent = result.Transaction.events.find(
	(event) =>
		event.packageId === package_id &&
		event.module === module &&
		event.eventType === `${package_id}::${module}::SignerCreated`,
);
if (!signerCreatedEvent) throw new Error("No signer created event");

const { signer_id } = SignerCreatedEvent.parse(signerCreatedEvent.bcs);

console.log({
	signer_id,
});
