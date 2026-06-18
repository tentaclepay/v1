import {
	createRandomSessionIdentifier,
	Curve,
	getNetworkConfig,
	IkaClient,
	prepareDKGAsync,
	UserShareEncryptionKeys,
} from "@ika.xyz/sdk";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { coinWithBalance, Transaction } from "@mysten/sui/transactions";

import {
	baseUrl,
	network,
	owner,
	tentaclepayAdminCap,
	tentaclepayPackageId,
} from "./shared";

const curve = 0; // SECP256K1
const signatureAlgorithm = 0; // ECDSA
const hashScheme = 0; // Keccak256

const initialIka = 50_000_000;
const initialSui = 50_000_000;

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
	new TextEncoder().encode(Bun.env.SEED!),
	Curve.SECP256K1,
);

const identifier = createRandomSessionIdentifier();

// Prepare DKG - this generates the necessary cryptographic materials
const dkgRequestInput = await prepareDKGAsync(
	ikaClient,
	Curve.SECP256K1,
	userShareEncryptionKeys,
	identifier,
	owner.toSuiAddress(),
);

const tx = new Transaction();

tx.setSender(owner.toSuiAddress());
tx.moveCall({
	package: tentaclepayPackageId,
	module: "tentaclepay",
	function: "create_signer",
	arguments: [
		tx.object(tentaclepayAdminCap),
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
			type: "0x1f26bb2f711ff82dcda4d02c77d5123089cb7f8418751474b9fb744ce031526a::ika::IKA",
		}),
		coinWithBalance({ balance: initialSui }),
	],
});

const txBytes = await tx.build({ client: suiClient });

const txResult = await suiClient.signAndExecuteTransaction({
	transaction: txBytes,
	signer: owner,
	include: {
		transaction: true,
		effects: true,
	},
});

console.dir(txResult, { depth: Infinity });
