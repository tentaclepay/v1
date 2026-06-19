import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";

import { admin_cap, module, package_id } from "./state.json";

import {
	baseUrl,
	network,
	ProtocolCreatedEvent,
	publisher,
	verifier,
} from "./shared";

const publisherAddress = publisher.toSuiAddress();

const suiClient = new SuiGrpcClient({
	network,
	baseUrl,
});

const tx = new Transaction();

tx.setSender(publisherAddress);
tx.moveCall({
	package: package_id,
	module: module,
	function: "create_protocol",
	arguments: [
		tx.object(admin_cap),
		tx.pure.vector("u8", Array.from(verifier.getPublicKey().toRawBytes())),
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

const protocolCreatedEvent = result.Transaction.events.find(
	(event) =>
		event.packageId === package_id &&
		event.module === module &&
		event.eventType === `${package_id}::${module}::ProtocolCreated`,
);
if (!protocolCreatedEvent) throw new Error("No protocol created event");

const { protocol_id } = ProtocolCreatedEvent.parse(protocolCreatedEvent.bcs);

console.log({
	protocol_id,
});
