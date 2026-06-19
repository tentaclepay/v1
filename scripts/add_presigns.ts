import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";

import { module, package_id, signer_id } from "./state.json";

import { getNetworkConfig, IkaClient } from "@ika.xyz/sdk";
import { baseUrl, network, publisher } from "./shared";

const count = 5;

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

const tx = new Transaction();

tx.setSender(publisherAddress);
tx.moveCall({
	package: package_id,
	module: module,
	function: "add_presigns",
	arguments: [
		tx.object(signer_id),
		tx.object(ikaCoordinator.objectID),
		tx.pure.u64(count),
	],
});

const txBytes = await tx.build({ client: suiClient });

const result = await suiClient.signAndExecuteTransaction({
	transaction: txBytes,
	signer: publisher,
});

if (result.$kind === "FailedTransaction")
	throw new Error("Transaction failed!");

console.log({
	digest: result.Transaction.digest,
});
