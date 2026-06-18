import {
	Curve,
	getNetworkConfig,
	IkaClient,
	publicKeyFromDWalletOutput,
} from "@ika.xyz/sdk";
import { SuiGrpcClient } from "@mysten/sui/grpc";

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { toHex } from "viem";
import { publicKeyToAddress } from "viem/accounts";
import { baseUrl, currentSignerId, network, signerBcs } from "./shared";

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
	objectId: currentSignerId,
	include: {
		content: true,
	},
});

if (!signerObject) throw new Error("Invalid signer object");

const signer = signerBcs.parse(signerObject.content);

const dwallet = await ikaClient.getDWallet(signer.dwallet_cap.dwallet_id);

if (dwallet.state.$kind !== "Active") throw new Error("Wallet not activated");

// publicKeyFromDWalletOutput returns a COMPRESSED secp256k1 key (33 bytes, 0x02/0x03 prefix).
const publicKey = await publicKeyFromDWalletOutput(
	Curve.SECP256K1,
	Uint8Array.from(dwallet.state.Active.public_output),
);

// viem's publicKeyToAddress expects an UNCOMPRESSED key (65 bytes, 0x04 prefix) — it strips the
// first byte and hashes the rest. Feeding it the compressed key hashes only X => wrong address.
// Decompress first, then derive: address = keccak256(X || Y)[-20:].
const uncompressed = secp256k1.Point.fromHex(publicKey.toHex()).toBytes(false);

const evmAddress = publicKeyToAddress(toHex(uncompressed));

console.log(evmAddress);
