import { getNetworkConfig, IkaClient } from "@ika.xyz/sdk";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { baseUrl, network } from "./shared";

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

const ika = ikaClient.ikaConfig;

console.dir(ika, { depth: Infinity });
