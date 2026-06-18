import { bcs } from "@mysten/sui/bcs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromHex, toHex } from "@mysten/sui/utils";
import crypto from "node:crypto";

export const network = "testnet";
export const baseUrl = "https://fullnode.testnet.sui.io:443";

export const owner = Ed25519Keypair.fromSecretKey(Bun.env.OWNER_SECRET_KEY!);

export const tentaclepayPackageId =
	"0x859c8fce972e1c5f013855b6f531c7b8dee43e03e283efefc67fb53061288ccc" as const;
export const tentaclepayAdminCap =
	"0xb85cc279edfd1a9ed04f6054db26253e30e42f30194474950cdbd85931c4b739" as const;
export const currentSignerId =
	"0x08925bd9778d12a863957e193ef4aa3604c1dd8c912b3fa9168e983dab6c2e94" as const;
export const signerEvmAddress =
	"0x115fa93f3B8B89fe15be775777ad966452119363" as const;

export const createNonce = (): `0x${string}` =>
	`0x${crypto.getRandomValues(new Uint8Array(32)).toHex()}`;

const ID = bcs.fixedArray(32, bcs.u8()).transform({
	input: (id: string) => fromHex(id.startsWith("0x") ? id.slice(2) : id),
	output: (id) => `0x${toHex(Uint8Array.from(id))}`,
});

const UID = bcs.struct("UID", {
	id: ID,
});

const DWalletCap = bcs.struct("DWalletCap", {
	id: UID,
	dwallet_id: ID,
});

const UnverifiedPresignCap = bcs.struct("UnverifiedPresignCap", {
	id: UID,
	dwallet_id: bcs.option(ID),
	presign_id: ID,
});

const Balance = bcs.struct("Balance", {
	value: bcs.U64,
});

export const signerBcs = bcs.struct("Signer", {
	id: UID,
	network_encryption_key_id: ID,
	dwallet_cap: DWalletCap,
	curve: bcs.U32,
	signature_algorithm: bcs.U32,
	hash_scheme: bcs.U32,
	presigns: bcs.vector(UnverifiedPresignCap),
	ika_balance: Balance,
	sui_balance: Balance,
});

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
