import { secp256k1 } from "@noble/curves/secp256k1.js";
import type { Address, Hex } from "viem";
import {
	concat,
	fromHex,
	getTypesForEIP712Domain,
	hashDomain,
	hashStruct,
	toHex,
} from "viem";
import { publicKeyToAddress } from "viem/accounts";

export const publicKeyToEvmAddress = (publicKey: Uint8Array) => {
	// viem's publicKeyToAddress expects an UNCOMPRESSED key (65 bytes, 0x04 prefix) — it strips the
	// first byte and hashes the rest. Feeding it the compressed key hashes only X => wrong address.
	// Decompress first, then derive: address = keccak256(X || Y)[-20:].
	const uncompressed = secp256k1.Point.fromHex(publicKey.toHex()).toBytes(
		false,
	);

	return publicKeyToAddress(toHex(uncompressed));
};

export const authorizationTypes = {
	TransferWithAuthorization: [
		{ name: "from", type: "address" },
		{ name: "to", type: "address" },
		{ name: "value", type: "uint256" },
		{ name: "validAfter", type: "uint256" },
		{ name: "validBefore", type: "uint256" },
		{ name: "nonce", type: "bytes32" },
	],
} as const;

export const eip3009Abi = [
	{
		inputs: [
			{ name: "from", type: "address" },
			{ name: "to", type: "address" },
			{ name: "value", type: "uint256" },
			{ name: "validAfter", type: "uint256" },
			{ name: "validBefore", type: "uint256" },
			{ name: "nonce", type: "bytes32" },
			{ name: "v", type: "uint8" },
			{ name: "r", type: "bytes32" },
			{ name: "s", type: "bytes32" },
		],
		name: "transferWithAuthorization",
		outputs: [],
		stateMutability: "nonpayable",
		type: "function",
	},
	{
		inputs: [
			{ name: "from", type: "address" },
			{ name: "to", type: "address" },
			{ name: "value", type: "uint256" },
			{ name: "validAfter", type: "uint256" },
			{ name: "validBefore", type: "uint256" },
			{ name: "nonce", type: "bytes32" },
			{ name: "signature", type: "bytes" },
		],
		name: "transferWithAuthorization",
		outputs: [],
		stateMutability: "nonpayable",
		type: "function",
	},
	{
		inputs: [{ name: "account", type: "address" }],
		name: "balanceOf",
		outputs: [{ name: "", type: "uint256" }],
		stateMutability: "view",
		type: "function",
	},
	{
		inputs: [],
		name: "version",
		outputs: [{ name: "", type: "string" }],
		stateMutability: "view",
		type: "function",
	},
	{
		inputs: [],
		name: "name",
		outputs: [{ name: "", type: "string" }],
		stateMutability: "view",
		type: "function",
	},
	{
		inputs: [
			{ name: "authorizer", type: "address" },
			{ name: "nonce", type: "bytes32" },
		],
		name: "authorizationState",
		outputs: [{ name: "", type: "bool" }],
		stateMutability: "view",
		type: "function",
	},
] as const;

export type TransferWithAuthorizarionParams = {
	chainId: number;
	contractAddress: string;
	name: string;
	version: string;
	nonce: string;
	from: string;
	to: string;
	value: bigint;
	validAfter?: bigint;
	validBefore?: bigint;
};

export const buildTransferWithAuthorizationPreimage = ({
	nonce,
	chainId,
	contractAddress,
	name,
	version,
	from,
	to,
	value,
	validAfter,
	validBefore,
}: TransferWithAuthorizarionParams) => {
	const domain = {
		chainId,
		name,
		version,
		verifyingContract: contractAddress as Address,
	} as const;

	const data = {
		from: from as Address,
		to: to as Address,
		value,
		validAfter: validAfter ?? 0n,
		validBefore: validBefore ?? BigInt(Math.floor(Date.now() / 1000) + 3600),
		nonce: nonce as Hex,
	};

	const types = {
		EIP712Domain: getTypesForEIP712Domain({ domain }),
		...authorizationTypes,
	};

	const transferWithAuthorizationPreimage = concat([
		"0x1901",
		hashDomain({ domain, types }),
		hashStruct({
			data,
			primaryType: "TransferWithAuthorization",
			types,
		}),
	]);

	const transferWithAuthorizationMessageBytes = fromHex(
		transferWithAuthorizationPreimage,
		"bytes",
	);

	return Uint8Array.from(transferWithAuthorizationMessageBytes);
};

export function ikaSignatureToEthSignature(signature: number[] | Uint8Array) {
	const bytes =
		signature instanceof Uint8Array ? signature : Uint8Array.from(signature);
	const [recoveryId] = bytes;

	const r = toHex(bytes.slice(1, 33));
	const s = toHex(bytes.slice(33, 65));
	const v = recoveryId! + 27;

	return concat([r, s, toHex(v, { size: 1 })]);
}
