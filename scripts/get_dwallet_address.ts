import { SuiGrpcClient } from "@mysten/sui/grpc";

import { signer_id } from "./state.json";

import { baseUrl, network, parseIkaCurve, Signer, type Curve } from "./shared";
import {
	getNetworkConfig,
	IkaClient,
	publicKeyFromDWalletOutput,
} from "@ika.xyz/sdk";
import { publicKeyToEvmAddress } from "./lib/evm";

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

const publicKey = await publicKeyFromDWalletOutput(
	parseIkaCurve(dwallet.curve as Curve),
	Uint8Array.from(dwallet.state.Active.public_output),
);

const evmAddress = publicKeyToEvmAddress(publicKey);

console.log({
	evmAddress,
});
