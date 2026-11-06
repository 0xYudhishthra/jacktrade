// Generado por pnpm sync:exports desde jacktradeexchange/contracts@main (deb2264). No editar.
export default {
  "chainId": 4663,
  "name": "Robinhood Chain",
  "rpcUrl": "https://rpc.mainnet.chain.robinhood.com",
  "explorer": "https://robinhoodchain.blockscout.com",
  "collateral": {
    "address": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    "symbol": "USDG",
    "decimals": 6
  },
  "token": {
    "address": "0x10f1fd34d2b3b1b6e5a56b4e08e44d25d9df7a76",
    "name": "JackTrade",
    "symbol": "JACKTRADE",
    "decimals": 18
  },
  "pyth": "0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a",
  "markets": [
    {
      "id": 0,
      "name": "BTC/USD",
      "pythId": "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
      "maxLeverage": 1000
    },
    {
      "id": 1,
      "name": "ETH/USD",
      "pythId": "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
      "maxLeverage": 1000
    }
  ],
  "contracts": {
    "Exchange": {
      "address": "0x698cf1a9220f89ccf6ee75269086288a623ede54",
      "abi": [
        {
          "inputs": [],
          "stateMutability": "nonpayable",
          "type": "constructor"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "target",
              "type": "address"
            }
          ],
          "name": "AddressEmptyCode",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "BelowMinimum",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "implementation",
              "type": "address"
            }
          ],
          "name": "ERC1967InvalidImplementation",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "ERC1967NonPayable",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "EscapeNotActive",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "FailedCall",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "InsufficientBalance",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "IntentExpired",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "InvalidConfig",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "InvalidInitialization",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "InvalidLeverage",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "InvalidSignature",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "InvalidSize",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "MarketAlreadyListed",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "MarketIsRetired",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "MarketNotListed",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "NonceAlreadyUsed",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "NotDevFeeRecipient",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "NotExecutor",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "NotGuardian",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "NotInitializing",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "NotMarketKeeper",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "NotPositionOwner",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "NotStaking",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "OiCapExceeded",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "owner",
              "type": "address"
            }
          ],
          "name": "OwnableInvalidOwner",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "account",
              "type": "address"
            }
          ],
          "name": "OwnableUnauthorizedAccount",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "PermitFailed",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "PositionLiquidatable",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "PositionNotFound",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "PriceJump",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "PriceLimitExceeded",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "PriceTooOld",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "PriceUncertain",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "ReentrancyGuardReentrantCall",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "uint8",
              "name": "bits",
              "type": "uint8"
            },
            {
              "internalType": "uint256",
              "name": "value",
              "type": "uint256"
            }
          ],
          "name": "SafeCastOverflowedUintDowncast",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "uint256",
              "name": "value",
              "type": "uint256"
            }
          ],
          "name": "SafeCastOverflowedUintToInt",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "token",
              "type": "address"
            }
          ],
          "name": "SafeERC20FailedOperation",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "SignatureExpired",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "TradingIsPaused",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "UUPSUnauthorizedCallContext",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "bytes32",
              "name": "slot",
              "type": "bytes32"
            }
          ],
          "name": "UUPSUnsupportedProxiableUUID",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "ZeroAddress",
          "type": "error"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "enum Exchange.Role",
              "name": "role",
              "type": "uint8"
            },
            {
              "indexed": false,
              "internalType": "address",
              "name": "account",
              "type": "address"
            }
          ],
          "name": "AddressSet",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "amount",
              "type": "uint256"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "activationFee",
              "type": "uint256"
            }
          ],
          "name": "Deposited",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "to",
              "type": "address"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "amount",
              "type": "uint256"
            }
          ],
          "name": "DevFeesClaimed",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [],
          "name": "EIP712DomainChanged",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "components": [
                {
                  "internalType": "uint16",
                  "name": "winFeeBps",
                  "type": "uint16"
                },
                {
                  "internalType": "uint16",
                  "name": "lossFeeBps",
                  "type": "uint16"
                },
                {
                  "internalType": "uint16",
                  "name": "liqFeeBps",
                  "type": "uint16"
                }
              ],
              "indexed": false,
              "internalType": "struct Exchange.Fees",
              "name": "fees",
              "type": "tuple"
            }
          ],
          "name": "FeesSet",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "timestamp",
              "type": "uint256"
            }
          ],
          "name": "Heartbeat",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": false,
              "internalType": "uint64",
              "name": "version",
              "type": "uint64"
            }
          ],
          "name": "Initialized",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "components": [
                {
                  "internalType": "uint32",
                  "name": "deadbandDivisor",
                  "type": "uint32"
                },
                {
                  "internalType": "uint32",
                  "name": "intentTtl",
                  "type": "uint32"
                },
                {
                  "internalType": "uint32",
                  "name": "escapeDelay",
                  "type": "uint32"
                },
                {
                  "internalType": "uint32",
                  "name": "priceJumpWindow",
                  "type": "uint32"
                },
                {
                  "internalType": "uint256",
                  "name": "minDeposit",
                  "type": "uint256"
                },
                {
                  "internalType": "uint256",
                  "name": "minWithdraw",
                  "type": "uint256"
                },
                {
                  "internalType": "uint256",
                  "name": "activationFee",
                  "type": "uint256"
                },
                {
                  "internalType": "uint256",
                  "name": "stakerRewardCap",
                  "type": "uint256"
                }
              ],
              "indexed": false,
              "internalType": "struct Exchange.Limits",
              "name": "limits",
              "type": "tuple"
            }
          ],
          "name": "LimitsSet",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "uint32",
              "name": "instrumentId",
              "type": "uint32"
            }
          ],
          "name": "MarketConfigSet",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "uint32",
              "name": "instrumentId",
              "type": "uint32"
            }
          ],
          "name": "MarketListed",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "uint32",
              "name": "instrumentId",
              "type": "uint32"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "frozenPrice",
              "type": "uint256"
            }
          ],
          "name": "MarketRetired",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "uint32",
              "name": "instrumentId",
              "type": "uint32"
            }
          ],
          "name": "MarketRiskSet",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "previousOwner",
              "type": "address"
            },
            {
              "indexed": true,
              "internalType": "address",
              "name": "newOwner",
              "type": "address"
            }
          ],
          "name": "OwnershipTransferStarted",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "previousOwner",
              "type": "address"
            },
            {
              "indexed": true,
              "internalType": "address",
              "name": "newOwner",
              "type": "address"
            }
          ],
          "name": "OwnershipTransferred",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "uint256",
              "name": "index",
              "type": "uint256"
            },
            {
              "indexed": true,
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "amount",
              "type": "uint256"
            }
          ],
          "name": "PayoutQueued",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "uint256",
              "name": "positionId",
              "type": "uint256"
            },
            {
              "indexed": true,
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "exitPrice",
              "type": "uint256"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "payout",
              "type": "uint256"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "loss",
              "type": "uint256"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "fee",
              "type": "uint256"
            }
          ],
          "name": "PositionClosed",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "uint256",
              "name": "positionId",
              "type": "uint256"
            },
            {
              "indexed": true,
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "price",
              "type": "uint256"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "margin",
              "type": "uint256"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "fee",
              "type": "uint256"
            }
          ],
          "name": "PositionLiquidated",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "uint256",
              "name": "positionId",
              "type": "uint256"
            },
            {
              "indexed": true,
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "indexed": true,
              "internalType": "uint32",
              "name": "instrumentId",
              "type": "uint32"
            },
            {
              "indexed": false,
              "internalType": "bool",
              "name": "isLong",
              "type": "bool"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "margin",
              "type": "uint256"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "leverage",
              "type": "uint256"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "entryPrice",
              "type": "uint256"
            }
          ],
          "name": "PositionOpened",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "uint256",
              "name": "index",
              "type": "uint256"
            },
            {
              "indexed": true,
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "amount",
              "type": "uint256"
            }
          ],
          "name": "QueuePaid",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "fees",
              "type": "uint256"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "lpExcess",
              "type": "uint256"
            }
          ],
          "name": "StakerFeesPushed",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "amount",
              "type": "uint256"
            }
          ],
          "name": "StakingRewardCredited",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "basis",
              "type": "uint256"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "amount",
              "type": "uint256"
            }
          ],
          "name": "TokensMinted",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": false,
              "internalType": "bool",
              "name": "paused",
              "type": "bool"
            }
          ],
          "name": "TradingPausedSet",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "implementation",
              "type": "address"
            }
          ],
          "name": "Upgraded",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "indexed": true,
              "internalType": "address",
              "name": "to",
              "type": "address"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "amount",
              "type": "uint256"
            }
          ],
          "name": "Withdrawn",
          "type": "event"
        },
        {
          "inputs": [],
          "name": "CLOSE_TYPEHASH",
          "outputs": [
            {
              "internalType": "bytes32",
              "name": "",
              "type": "bytes32"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "OPEN_TYPEHASH",
          "outputs": [
            {
              "internalType": "bytes32",
              "name": "",
              "type": "bytes32"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "UPGRADE_INTERFACE_VERSION",
          "outputs": [
            {
              "internalType": "string",
              "name": "",
              "type": "string"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "WITHDRAW_TYPEHASH",
          "outputs": [
            {
              "internalType": "bytes32",
              "name": "",
              "type": "bytes32"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "acceptOwnership",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "accountedCollateral",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "name": "activated",
          "outputs": [
            {
              "internalType": "bool",
              "name": "",
              "type": "bool"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "name": "balances",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "claimDevFees",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "uint256",
              "name": "positionId",
              "type": "uint256"
            }
          ],
          "name": "closePosition",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "components": [
                {
                  "internalType": "address",
                  "name": "user",
                  "type": "address"
                },
                {
                  "internalType": "uint256",
                  "name": "positionId",
                  "type": "uint256"
                },
                {
                  "internalType": "uint256",
                  "name": "priceLimit",
                  "type": "uint256"
                },
                {
                  "internalType": "uint256",
                  "name": "signedAt",
                  "type": "uint256"
                },
                {
                  "internalType": "uint256",
                  "name": "nonce",
                  "type": "uint256"
                }
              ],
              "internalType": "struct Exchange.CloseIntent",
              "name": "it",
              "type": "tuple"
            },
            {
              "internalType": "bytes",
              "name": "signature",
              "type": "bytes"
            }
          ],
          "name": "closePositionBySig",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "collateral",
          "outputs": [
            {
              "internalType": "contract IERC20",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "internalType": "uint256",
              "name": "amount",
              "type": "uint256"
            }
          ],
          "name": "creditStakingReward",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "uint256",
              "name": "amount",
              "type": "uint256"
            }
          ],
          "name": "deposit",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "internalType": "uint256",
              "name": "amount",
              "type": "uint256"
            }
          ],
          "name": "depositFor",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "internalType": "uint256",
              "name": "amount",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "deadline",
              "type": "uint256"
            },
            {
              "internalType": "uint8",
              "name": "v",
              "type": "uint8"
            },
            {
              "internalType": "bytes32",
              "name": "r",
              "type": "bytes32"
            },
            {
              "internalType": "bytes32",
              "name": "s",
              "type": "bytes32"
            }
          ],
          "name": "depositWithPermit",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "devFeeAccrued",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "devFeeRecipient",
          "outputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "eip712Domain",
          "outputs": [
            {
              "internalType": "bytes1",
              "name": "fields",
              "type": "bytes1"
            },
            {
              "internalType": "string",
              "name": "name",
              "type": "string"
            },
            {
              "internalType": "string",
              "name": "version",
              "type": "string"
            },
            {
              "internalType": "uint256",
              "name": "chainId",
              "type": "uint256"
            },
            {
              "internalType": "address",
              "name": "verifyingContract",
              "type": "address"
            },
            {
              "internalType": "bytes32",
              "name": "salt",
              "type": "bytes32"
            },
            {
              "internalType": "uint256[]",
              "name": "extensions",
              "type": "uint256[]"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "executor",
          "outputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "fees",
          "outputs": [
            {
              "internalType": "uint16",
              "name": "winFeeBps",
              "type": "uint16"
            },
            {
              "internalType": "uint16",
              "name": "lossFeeBps",
              "type": "uint16"
            },
            {
              "internalType": "uint16",
              "name": "liqFeeBps",
              "type": "uint16"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "guardian",
          "outputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "uint256",
              "name": "maxEntries",
              "type": "uint256"
            }
          ],
          "name": "harvest",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "paid",
              "type": "uint256"
            }
          ],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "heartbeat",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "components": [
                {
                  "internalType": "address",
                  "name": "owner",
                  "type": "address"
                },
                {
                  "internalType": "address",
                  "name": "collateral",
                  "type": "address"
                },
                {
                  "internalType": "address",
                  "name": "oracle",
                  "type": "address"
                },
                {
                  "internalType": "address",
                  "name": "sessionKeys",
                  "type": "address"
                },
                {
                  "internalType": "address",
                  "name": "tokenomics",
                  "type": "address"
                },
                {
                  "internalType": "address",
                  "name": "staking",
                  "type": "address"
                },
                {
                  "internalType": "address",
                  "name": "executor",
                  "type": "address"
                },
                {
                  "internalType": "address",
                  "name": "guardian",
                  "type": "address"
                },
                {
                  "internalType": "address",
                  "name": "marketKeeper",
                  "type": "address"
                },
                {
                  "internalType": "address",
                  "name": "devFeeRecipient",
                  "type": "address"
                },
                {
                  "components": [
                    {
                      "internalType": "uint16",
                      "name": "winFeeBps",
                      "type": "uint16"
                    },
                    {
                      "internalType": "uint16",
                      "name": "lossFeeBps",
                      "type": "uint16"
                    },
                    {
                      "internalType": "uint16",
                      "name": "liqFeeBps",
                      "type": "uint16"
                    }
                  ],
                  "internalType": "struct Exchange.Fees",
                  "name": "fees",
                  "type": "tuple"
                },
                {
                  "components": [
                    {
                      "internalType": "uint32",
                      "name": "deadbandDivisor",
                      "type": "uint32"
                    },
                    {
                      "internalType": "uint32",
                      "name": "intentTtl",
                      "type": "uint32"
                    },
                    {
                      "internalType": "uint32",
                      "name": "escapeDelay",
                      "type": "uint32"
                    },
                    {
                      "internalType": "uint32",
                      "name": "priceJumpWindow",
                      "type": "uint32"
                    },
                    {
                      "internalType": "uint256",
                      "name": "minDeposit",
                      "type": "uint256"
                    },
                    {
                      "internalType": "uint256",
                      "name": "minWithdraw",
                      "type": "uint256"
                    },
                    {
                      "internalType": "uint256",
                      "name": "activationFee",
                      "type": "uint256"
                    },
                    {
                      "internalType": "uint256",
                      "name": "stakerRewardCap",
                      "type": "uint256"
                    }
                  ],
                  "internalType": "struct Exchange.Limits",
                  "name": "limits",
                  "type": "tuple"
                }
              ],
              "internalType": "struct Exchange.InitParams",
              "name": "p",
              "type": "tuple"
            }
          ],
          "name": "initialize",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "uint256",
              "name": "nonce",
              "type": "uint256"
            }
          ],
          "name": "invalidateNonce",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "lastExecutorActivity",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "limits",
          "outputs": [
            {
              "internalType": "uint32",
              "name": "deadbandDivisor",
              "type": "uint32"
            },
            {
              "internalType": "uint32",
              "name": "intentTtl",
              "type": "uint32"
            },
            {
              "internalType": "uint32",
              "name": "escapeDelay",
              "type": "uint32"
            },
            {
              "internalType": "uint32",
              "name": "priceJumpWindow",
              "type": "uint32"
            },
            {
              "internalType": "uint256",
              "name": "minDeposit",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "minWithdraw",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "activationFee",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "stakerRewardCap",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "uint256[]",
              "name": "positionIds",
              "type": "uint256[]"
            }
          ],
          "name": "liquidate",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "count",
              "type": "uint256"
            }
          ],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "uint32",
              "name": "instrumentId",
              "type": "uint32"
            },
            {
              "components": [
                {
                  "internalType": "uint16",
                  "name": "maxLeverage",
                  "type": "uint16"
                },
                {
                  "internalType": "uint16",
                  "name": "liqBufferBps",
                  "type": "uint16"
                },
                {
                  "internalType": "uint16",
                  "name": "maxConfBps",
                  "type": "uint16"
                },
                {
                  "internalType": "uint16",
                  "name": "maxPriceJumpBps",
                  "type": "uint16"
                },
                {
                  "internalType": "uint256",
                  "name": "maxNotional",
                  "type": "uint256"
                },
                {
                  "components": [
                    {
                      "internalType": "uint256",
                      "name": "baseRate",
                      "type": "uint256"
                    },
                    {
                      "internalType": "uint256",
                      "name": "rateMultiplier",
                      "type": "uint256"
                    },
                    {
                      "internalType": "uint256",
                      "name": "positionMultiplier",
                      "type": "uint256"
                    },
                    {
                      "internalType": "uint256",
                      "name": "referenceNotional",
                      "type": "uint256"
                    }
                  ],
                  "internalType": "struct PnLMath.ImpactParams",
                  "name": "impact",
                  "type": "tuple"
                }
              ],
              "internalType": "struct Exchange.MarketConfig",
              "name": "cfg",
              "type": "tuple"
            },
            {
              "components": [
                {
                  "internalType": "uint256",
                  "name": "minMargin",
                  "type": "uint256"
                },
                {
                  "internalType": "uint256",
                  "name": "minNotional",
                  "type": "uint256"
                },
                {
                  "internalType": "uint256",
                  "name": "longOiCap",
                  "type": "uint256"
                },
                {
                  "internalType": "uint256",
                  "name": "shortOiCap",
                  "type": "uint256"
                }
              ],
              "internalType": "struct Exchange.MarketRisk",
              "name": "risk",
              "type": "tuple"
            }
          ],
          "name": "listMarket",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "lpBankrollAvailable",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "lpCash",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "uint32",
              "name": "instrumentId",
              "type": "uint32"
            }
          ],
          "name": "marketConfig",
          "outputs": [
            {
              "components": [
                {
                  "internalType": "uint16",
                  "name": "maxLeverage",
                  "type": "uint16"
                },
                {
                  "internalType": "uint16",
                  "name": "liqBufferBps",
                  "type": "uint16"
                },
                {
                  "internalType": "uint16",
                  "name": "maxConfBps",
                  "type": "uint16"
                },
                {
                  "internalType": "uint16",
                  "name": "maxPriceJumpBps",
                  "type": "uint16"
                },
                {
                  "internalType": "uint256",
                  "name": "maxNotional",
                  "type": "uint256"
                },
                {
                  "components": [
                    {
                      "internalType": "uint256",
                      "name": "baseRate",
                      "type": "uint256"
                    },
                    {
                      "internalType": "uint256",
                      "name": "rateMultiplier",
                      "type": "uint256"
                    },
                    {
                      "internalType": "uint256",
                      "name": "positionMultiplier",
                      "type": "uint256"
                    },
                    {
                      "internalType": "uint256",
                      "name": "referenceNotional",
                      "type": "uint256"
                    }
                  ],
                  "internalType": "struct PnLMath.ImpactParams",
                  "name": "impact",
                  "type": "tuple"
                }
              ],
              "internalType": "struct Exchange.MarketConfig",
              "name": "",
              "type": "tuple"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "marketKeeper",
          "outputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "uint32",
              "name": "",
              "type": "uint32"
            }
          ],
          "name": "marketRisk",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "minMargin",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "minNotional",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "longOiCap",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "shortOiCap",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "uint32",
              "name": "",
              "type": "uint32"
            }
          ],
          "name": "marketState",
          "outputs": [
            {
              "internalType": "bool",
              "name": "listed",
              "type": "bool"
            },
            {
              "internalType": "bool",
              "name": "retired",
              "type": "bool"
            },
            {
              "internalType": "uint256",
              "name": "frozenPrice",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "longOi",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "shortOi",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "lastPrice",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "lastPriceTime",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "nextPositionId",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            },
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "name": "nonceUsed",
          "outputs": [
            {
              "internalType": "bool",
              "name": "",
              "type": "bool"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "components": [
                {
                  "internalType": "address",
                  "name": "user",
                  "type": "address"
                },
                {
                  "internalType": "uint32",
                  "name": "instrumentId",
                  "type": "uint32"
                },
                {
                  "internalType": "bool",
                  "name": "isLong",
                  "type": "bool"
                },
                {
                  "internalType": "uint256",
                  "name": "margin",
                  "type": "uint256"
                },
                {
                  "internalType": "uint256",
                  "name": "leverage",
                  "type": "uint256"
                },
                {
                  "internalType": "uint256",
                  "name": "priceLimit",
                  "type": "uint256"
                },
                {
                  "internalType": "uint256",
                  "name": "signedAt",
                  "type": "uint256"
                },
                {
                  "internalType": "uint256",
                  "name": "nonce",
                  "type": "uint256"
                }
              ],
              "internalType": "struct Exchange.OpenIntent",
              "name": "it",
              "type": "tuple"
            },
            {
              "internalType": "bytes",
              "name": "signature",
              "type": "bytes"
            }
          ],
          "name": "openPositionBySig",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "positionId",
              "type": "uint256"
            }
          ],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "oracle",
          "outputs": [
            {
              "internalType": "contract IPriceOracle",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "owner",
          "outputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "pendingOwner",
          "outputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "name": "positions",
          "outputs": [
            {
              "internalType": "address",
              "name": "owner",
              "type": "address"
            },
            {
              "internalType": "uint32",
              "name": "instrumentId",
              "type": "uint32"
            },
            {
              "internalType": "bool",
              "name": "isLong",
              "type": "bool"
            },
            {
              "internalType": "uint16",
              "name": "leverage",
              "type": "uint16"
            },
            {
              "internalType": "uint40",
              "name": "openedAt",
              "type": "uint40"
            },
            {
              "internalType": "uint128",
              "name": "margin",
              "type": "uint128"
            },
            {
              "internalType": "uint128",
              "name": "entryPrice",
              "type": "uint128"
            },
            {
              "internalType": "uint16",
              "name": "liqBufferBps",
              "type": "uint16"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "proxiableUUID",
          "outputs": [
            {
              "internalType": "bytes32",
              "name": "",
              "type": "bytes32"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "pushStakerFees",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "name": "queue",
          "outputs": [
            {
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "internalType": "uint96",
              "name": "amount",
              "type": "uint96"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "queueHead",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "queueTail",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "name": "queuedOf",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "renounceOwnership",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "uint32",
              "name": "instrumentId",
              "type": "uint32"
            }
          ],
          "name": "retireMarket",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "sessionKeys",
          "outputs": [
            {
              "internalType": "contract ISessionKeyManager",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "enum Exchange.Role",
              "name": "role",
              "type": "uint8"
            },
            {
              "internalType": "address",
              "name": "a",
              "type": "address"
            }
          ],
          "name": "setAddress",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "components": [
                {
                  "internalType": "uint16",
                  "name": "winFeeBps",
                  "type": "uint16"
                },
                {
                  "internalType": "uint16",
                  "name": "lossFeeBps",
                  "type": "uint16"
                },
                {
                  "internalType": "uint16",
                  "name": "liqFeeBps",
                  "type": "uint16"
                }
              ],
              "internalType": "struct Exchange.Fees",
              "name": "f",
              "type": "tuple"
            }
          ],
          "name": "setFees",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "components": [
                {
                  "internalType": "uint32",
                  "name": "deadbandDivisor",
                  "type": "uint32"
                },
                {
                  "internalType": "uint32",
                  "name": "intentTtl",
                  "type": "uint32"
                },
                {
                  "internalType": "uint32",
                  "name": "escapeDelay",
                  "type": "uint32"
                },
                {
                  "internalType": "uint32",
                  "name": "priceJumpWindow",
                  "type": "uint32"
                },
                {
                  "internalType": "uint256",
                  "name": "minDeposit",
                  "type": "uint256"
                },
                {
                  "internalType": "uint256",
                  "name": "minWithdraw",
                  "type": "uint256"
                },
                {
                  "internalType": "uint256",
                  "name": "activationFee",
                  "type": "uint256"
                },
                {
                  "internalType": "uint256",
                  "name": "stakerRewardCap",
                  "type": "uint256"
                }
              ],
              "internalType": "struct Exchange.Limits",
              "name": "l",
              "type": "tuple"
            }
          ],
          "name": "setLimits",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "uint32",
              "name": "instrumentId",
              "type": "uint32"
            },
            {
              "components": [
                {
                  "internalType": "uint16",
                  "name": "maxLeverage",
                  "type": "uint16"
                },
                {
                  "internalType": "uint16",
                  "name": "liqBufferBps",
                  "type": "uint16"
                },
                {
                  "internalType": "uint16",
                  "name": "maxConfBps",
                  "type": "uint16"
                },
                {
                  "internalType": "uint16",
                  "name": "maxPriceJumpBps",
                  "type": "uint16"
                },
                {
                  "internalType": "uint256",
                  "name": "maxNotional",
                  "type": "uint256"
                },
                {
                  "components": [
                    {
                      "internalType": "uint256",
                      "name": "baseRate",
                      "type": "uint256"
                    },
                    {
                      "internalType": "uint256",
                      "name": "rateMultiplier",
                      "type": "uint256"
                    },
                    {
                      "internalType": "uint256",
                      "name": "positionMultiplier",
                      "type": "uint256"
                    },
                    {
                      "internalType": "uint256",
                      "name": "referenceNotional",
                      "type": "uint256"
                    }
                  ],
                  "internalType": "struct PnLMath.ImpactParams",
                  "name": "impact",
                  "type": "tuple"
                }
              ],
              "internalType": "struct Exchange.MarketConfig",
              "name": "cfg",
              "type": "tuple"
            }
          ],
          "name": "setMarketConfig",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "uint32",
              "name": "instrumentId",
              "type": "uint32"
            },
            {
              "components": [
                {
                  "internalType": "uint256",
                  "name": "minMargin",
                  "type": "uint256"
                },
                {
                  "internalType": "uint256",
                  "name": "minNotional",
                  "type": "uint256"
                },
                {
                  "internalType": "uint256",
                  "name": "longOiCap",
                  "type": "uint256"
                },
                {
                  "internalType": "uint256",
                  "name": "shortOiCap",
                  "type": "uint256"
                }
              ],
              "internalType": "struct Exchange.MarketRisk",
              "name": "risk",
              "type": "tuple"
            }
          ],
          "name": "setMarketRisk",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "bool",
              "name": "paused",
              "type": "bool"
            }
          ],
          "name": "setTradingPaused",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "sideBucket",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "stakerFeeAccrued",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "staking",
          "outputs": [
            {
              "internalType": "contract IJackTradeStaking",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "stakingReserve",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "tokenomics",
          "outputs": [
            {
              "internalType": "contract IJackTradeTokenomics",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "totalBalances",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "totalMargin",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "totalQueued",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "trackedLp",
          "outputs": [
            {
              "internalType": "int256",
              "name": "",
              "type": "int256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "tradingPaused",
          "outputs": [
            {
              "internalType": "bool",
              "name": "",
              "type": "bool"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "newOwner",
              "type": "address"
            }
          ],
          "name": "transferOwnership",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "newImplementation",
              "type": "address"
            },
            {
              "internalType": "bytes",
              "name": "data",
              "type": "bytes"
            }
          ],
          "name": "upgradeToAndCall",
          "outputs": [],
          "stateMutability": "payable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "to",
              "type": "address"
            },
            {
              "internalType": "uint256",
              "name": "amount",
              "type": "uint256"
            }
          ],
          "name": "withdraw",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "internalType": "address",
              "name": "to",
              "type": "address"
            },
            {
              "internalType": "uint256",
              "name": "amount",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "nonce",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "deadline",
              "type": "uint256"
            },
            {
              "internalType": "bytes",
              "name": "signature",
              "type": "bytes"
            }
          ],
          "name": "withdrawBySig",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        }
      ]
    },
    "BatchExecutor": {
      "address": "0xf612485f65e0ea7109a3eb09ea7e0abfabd167a4",
      "abi": [
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "owner_",
              "type": "address"
            },
            {
              "internalType": "address",
              "name": "oracle_",
              "type": "address"
            }
          ],
          "stateMutability": "nonpayable",
          "type": "constructor"
        },
        {
          "inputs": [
            {
              "internalType": "uint256",
              "name": "required",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "provided",
              "type": "uint256"
            }
          ],
          "name": "InsufficientFee",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "NotRelayer",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "owner",
              "type": "address"
            }
          ],
          "name": "OwnableInvalidOwner",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "account",
              "type": "address"
            }
          ],
          "name": "OwnableUnauthorizedAccount",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "ReentrancyGuardReentrantCall",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "RefundFailed",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "target",
              "type": "address"
            }
          ],
          "name": "TargetNotAllowed",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "ZeroAddress",
          "type": "error"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "relayer",
              "type": "address"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "calls",
              "type": "uint256"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "failed",
              "type": "uint256"
            }
          ],
          "name": "BatchExecuted",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "uint256",
              "name": "index",
              "type": "uint256"
            },
            {
              "indexed": true,
              "internalType": "address",
              "name": "target",
              "type": "address"
            },
            {
              "indexed": false,
              "internalType": "bytes",
              "name": "reason",
              "type": "bytes"
            }
          ],
          "name": "CallFailed",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "previousOwner",
              "type": "address"
            },
            {
              "indexed": true,
              "internalType": "address",
              "name": "newOwner",
              "type": "address"
            }
          ],
          "name": "OwnershipTransferStarted",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "previousOwner",
              "type": "address"
            },
            {
              "indexed": true,
              "internalType": "address",
              "name": "newOwner",
              "type": "address"
            }
          ],
          "name": "OwnershipTransferred",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "relayer",
              "type": "address"
            },
            {
              "indexed": false,
              "internalType": "bool",
              "name": "allowed",
              "type": "bool"
            }
          ],
          "name": "RelayerSet",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "target",
              "type": "address"
            },
            {
              "indexed": false,
              "internalType": "bool",
              "name": "allowed",
              "type": "bool"
            }
          ],
          "name": "TargetSet",
          "type": "event"
        },
        {
          "inputs": [],
          "name": "acceptOwnership",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "bytes[]",
              "name": "priceUpdates",
              "type": "bytes[]"
            },
            {
              "components": [
                {
                  "internalType": "address",
                  "name": "target",
                  "type": "address"
                },
                {
                  "internalType": "bytes",
                  "name": "data",
                  "type": "bytes"
                }
              ],
              "internalType": "struct BatchExecutor.Call[]",
              "name": "calls",
              "type": "tuple[]"
            }
          ],
          "name": "execute",
          "outputs": [
            {
              "internalType": "bool[]",
              "name": "ok",
              "type": "bool[]"
            }
          ],
          "stateMutability": "payable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "relayer",
              "type": "address"
            }
          ],
          "name": "isRelayer",
          "outputs": [
            {
              "internalType": "bool",
              "name": "",
              "type": "bool"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "target",
              "type": "address"
            }
          ],
          "name": "isTarget",
          "outputs": [
            {
              "internalType": "bool",
              "name": "",
              "type": "bool"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "oracle",
          "outputs": [
            {
              "internalType": "contract IPriceOracle",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "owner",
          "outputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "pendingOwner",
          "outputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "renounceOwnership",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "relayer",
              "type": "address"
            },
            {
              "internalType": "bool",
              "name": "allowed",
              "type": "bool"
            }
          ],
          "name": "setRelayer",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "target",
              "type": "address"
            },
            {
              "internalType": "bool",
              "name": "allowed",
              "type": "bool"
            }
          ],
          "name": "setTarget",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "newOwner",
              "type": "address"
            }
          ],
          "name": "transferOwnership",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        }
      ]
    },
    "SessionKeyManager": {
      "address": "0xe82bb6f411a9a53170f9c4fff53207eb80b7bb29",
      "abi": [
        {
          "inputs": [],
          "stateMutability": "nonpayable",
          "type": "constructor"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "target",
              "type": "address"
            }
          ],
          "name": "AddressEmptyCode",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "implementation",
              "type": "address"
            }
          ],
          "name": "ERC1967InvalidImplementation",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "ERC1967NonPayable",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "FailedCall",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "InvalidExpiry",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "InvalidInitialization",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "InvalidKey",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "InvalidSignature",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "NonceAlreadyUsed",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "NotInitializing",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "owner",
              "type": "address"
            }
          ],
          "name": "OwnableInvalidOwner",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "account",
              "type": "address"
            }
          ],
          "name": "OwnableUnauthorizedAccount",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "SignatureExpired",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "UUPSUnauthorizedCallContext",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "bytes32",
              "name": "slot",
              "type": "bytes32"
            }
          ],
          "name": "UUPSUnsupportedProxiableUUID",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "ZeroAddress",
          "type": "error"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "indexed": false,
              "internalType": "uint64",
              "name": "newEpoch",
              "type": "uint64"
            }
          ],
          "name": "AllSessionKeysRevoked",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [],
          "name": "EIP712DomainChanged",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": false,
              "internalType": "uint64",
              "name": "version",
              "type": "uint64"
            }
          ],
          "name": "Initialized",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "previousOwner",
              "type": "address"
            },
            {
              "indexed": true,
              "internalType": "address",
              "name": "newOwner",
              "type": "address"
            }
          ],
          "name": "OwnershipTransferStarted",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "previousOwner",
              "type": "address"
            },
            {
              "indexed": true,
              "internalType": "address",
              "name": "newOwner",
              "type": "address"
            }
          ],
          "name": "OwnershipTransferred",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "indexed": true,
              "internalType": "address",
              "name": "key",
              "type": "address"
            },
            {
              "indexed": false,
              "internalType": "uint64",
              "name": "expiry",
              "type": "uint64"
            }
          ],
          "name": "SessionKeyRegistered",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "indexed": true,
              "internalType": "address",
              "name": "key",
              "type": "address"
            }
          ],
          "name": "SessionKeyRevoked",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "implementation",
              "type": "address"
            }
          ],
          "name": "Upgraded",
          "type": "event"
        },
        {
          "inputs": [],
          "name": "MAX_DURATION",
          "outputs": [
            {
              "internalType": "uint64",
              "name": "",
              "type": "uint64"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "REGISTER_TYPEHASH",
          "outputs": [
            {
              "internalType": "bytes32",
              "name": "",
              "type": "bytes32"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "UPGRADE_INTERFACE_VERSION",
          "outputs": [
            {
              "internalType": "string",
              "name": "",
              "type": "string"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "acceptOwnership",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "eip712Domain",
          "outputs": [
            {
              "internalType": "bytes1",
              "name": "fields",
              "type": "bytes1"
            },
            {
              "internalType": "string",
              "name": "name",
              "type": "string"
            },
            {
              "internalType": "string",
              "name": "version",
              "type": "string"
            },
            {
              "internalType": "uint256",
              "name": "chainId",
              "type": "uint256"
            },
            {
              "internalType": "address",
              "name": "verifyingContract",
              "type": "address"
            },
            {
              "internalType": "bytes32",
              "name": "salt",
              "type": "bytes32"
            },
            {
              "internalType": "uint256[]",
              "name": "extensions",
              "type": "uint256[]"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "user",
              "type": "address"
            }
          ],
          "name": "epochOf",
          "outputs": [
            {
              "internalType": "uint64",
              "name": "",
              "type": "uint64"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "owner_",
              "type": "address"
            }
          ],
          "name": "initialize",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "uint256",
              "name": "nonce",
              "type": "uint256"
            }
          ],
          "name": "invalidateNonce",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "internalType": "address",
              "name": "key",
              "type": "address"
            }
          ],
          "name": "isValidSessionKey",
          "outputs": [
            {
              "internalType": "bool",
              "name": "",
              "type": "bool"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "internalType": "uint256",
              "name": "nonce",
              "type": "uint256"
            }
          ],
          "name": "nonceUsed",
          "outputs": [
            {
              "internalType": "bool",
              "name": "",
              "type": "bool"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "owner",
          "outputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "pendingOwner",
          "outputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "proxiableUUID",
          "outputs": [
            {
              "internalType": "bytes32",
              "name": "",
              "type": "bytes32"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "key",
              "type": "address"
            },
            {
              "internalType": "uint64",
              "name": "expiry",
              "type": "uint64"
            }
          ],
          "name": "registerSessionKey",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "internalType": "address",
              "name": "key",
              "type": "address"
            },
            {
              "internalType": "uint64",
              "name": "expiry",
              "type": "uint64"
            },
            {
              "internalType": "uint256",
              "name": "nonce",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "deadline",
              "type": "uint256"
            },
            {
              "internalType": "bytes",
              "name": "signature",
              "type": "bytes"
            }
          ],
          "name": "registerSessionKeyBySig",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "renounceOwnership",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "revokeAllSessionKeys",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "key",
              "type": "address"
            }
          ],
          "name": "revokeSessionKey",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "internalType": "address",
              "name": "key",
              "type": "address"
            }
          ],
          "name": "sessions",
          "outputs": [
            {
              "internalType": "uint64",
              "name": "expiry",
              "type": "uint64"
            },
            {
              "internalType": "uint64",
              "name": "epoch",
              "type": "uint64"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "newOwner",
              "type": "address"
            }
          ],
          "name": "transferOwnership",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "newImplementation",
              "type": "address"
            },
            {
              "internalType": "bytes",
              "name": "data",
              "type": "bytes"
            }
          ],
          "name": "upgradeToAndCall",
          "outputs": [],
          "stateMutability": "payable",
          "type": "function"
        }
      ]
    },
    "JackTradeStaking": {
      "address": "0xbe4fe6490c3feb50bfb347ac5ce641673e25d0bd",
      "abi": [
        {
          "inputs": [],
          "stateMutability": "nonpayable",
          "type": "constructor"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "target",
              "type": "address"
            }
          ],
          "name": "AddressEmptyCode",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "implementation",
              "type": "address"
            }
          ],
          "name": "ERC1967InvalidImplementation",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "ERC1967NonPayable",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "FailedCall",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "InsufficientStake",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "InvalidInitialization",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "InvalidSignature",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "NonceAlreadyUsed",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "NotExchange",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "NotInitializing",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "owner",
              "type": "address"
            }
          ],
          "name": "OwnableInvalidOwner",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "account",
              "type": "address"
            }
          ],
          "name": "OwnableUnauthorizedAccount",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "ReentrancyGuardReentrantCall",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "token",
              "type": "address"
            }
          ],
          "name": "SafeERC20FailedOperation",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "SignatureExpired",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "UUPSUnauthorizedCallContext",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "bytes32",
              "name": "slot",
              "type": "bytes32"
            }
          ],
          "name": "UUPSUnsupportedProxiableUUID",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "ZeroAddress",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "ZeroAmount",
          "type": "error"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "amount",
              "type": "uint256"
            }
          ],
          "name": "Claimed",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [],
          "name": "EIP712DomainChanged",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": false,
              "internalType": "address",
              "name": "exchange",
              "type": "address"
            }
          ],
          "name": "ExchangeSet",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": false,
              "internalType": "uint64",
              "name": "version",
              "type": "uint64"
            }
          ],
          "name": "Initialized",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "previousOwner",
              "type": "address"
            },
            {
              "indexed": true,
              "internalType": "address",
              "name": "newOwner",
              "type": "address"
            }
          ],
          "name": "OwnershipTransferStarted",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "previousOwner",
              "type": "address"
            },
            {
              "indexed": true,
              "internalType": "address",
              "name": "newOwner",
              "type": "address"
            }
          ],
          "name": "OwnershipTransferred",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "amount",
              "type": "uint256"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "accRewardPerShare",
              "type": "uint256"
            }
          ],
          "name": "RewardNotified",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "amount",
              "type": "uint256"
            }
          ],
          "name": "Staked",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "amount",
              "type": "uint256"
            }
          ],
          "name": "Unstaked",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "implementation",
              "type": "address"
            }
          ],
          "name": "Upgraded",
          "type": "event"
        },
        {
          "inputs": [],
          "name": "CLAIM_TYPEHASH",
          "outputs": [
            {
              "internalType": "bytes32",
              "name": "",
              "type": "bytes32"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "STAKE_TYPEHASH",
          "outputs": [
            {
              "internalType": "bytes32",
              "name": "",
              "type": "bytes32"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "UNSTAKE_TYPEHASH",
          "outputs": [
            {
              "internalType": "bytes32",
              "name": "",
              "type": "bytes32"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "UPGRADE_INTERFACE_VERSION",
          "outputs": [
            {
              "internalType": "string",
              "name": "",
              "type": "string"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "accRewardPerShare",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "acceptOwnership",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "user",
              "type": "address"
            }
          ],
          "name": "accrued",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "claim",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "internalType": "uint256",
              "name": "nonce",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "deadline",
              "type": "uint256"
            },
            {
              "internalType": "bytes",
              "name": "sig",
              "type": "bytes"
            }
          ],
          "name": "claimBySig",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "eip712Domain",
          "outputs": [
            {
              "internalType": "bytes1",
              "name": "fields",
              "type": "bytes1"
            },
            {
              "internalType": "string",
              "name": "name",
              "type": "string"
            },
            {
              "internalType": "string",
              "name": "version",
              "type": "string"
            },
            {
              "internalType": "uint256",
              "name": "chainId",
              "type": "uint256"
            },
            {
              "internalType": "address",
              "name": "verifyingContract",
              "type": "address"
            },
            {
              "internalType": "bytes32",
              "name": "salt",
              "type": "bytes32"
            },
            {
              "internalType": "uint256[]",
              "name": "extensions",
              "type": "uint256[]"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "exchange",
          "outputs": [
            {
              "internalType": "contract IExchangeRewards",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "owner_",
              "type": "address"
            },
            {
              "internalType": "address",
              "name": "token_",
              "type": "address"
            }
          ],
          "name": "initialize",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "uint256",
              "name": "nonce",
              "type": "uint256"
            }
          ],
          "name": "invalidateNonce",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "internalType": "uint256",
              "name": "nonce",
              "type": "uint256"
            }
          ],
          "name": "nonceUsed",
          "outputs": [
            {
              "internalType": "bool",
              "name": "",
              "type": "bool"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "uint256",
              "name": "amount",
              "type": "uint256"
            }
          ],
          "name": "notifyReward",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "owner",
          "outputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "pendingOwner",
          "outputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "user",
              "type": "address"
            }
          ],
          "name": "pendingReward",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "proxiableUUID",
          "outputs": [
            {
              "internalType": "bytes32",
              "name": "",
              "type": "bytes32"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "renounceOwnership",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "user",
              "type": "address"
            }
          ],
          "name": "rewardDebt",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "exchange_",
              "type": "address"
            }
          ],
          "name": "setExchange",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "uint256",
              "name": "amount",
              "type": "uint256"
            }
          ],
          "name": "stake",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "internalType": "uint256",
              "name": "amount",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "nonce",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "deadline",
              "type": "uint256"
            },
            {
              "internalType": "bytes",
              "name": "sig",
              "type": "bytes"
            }
          ],
          "name": "stakeBySig",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "user",
              "type": "address"
            }
          ],
          "name": "stakeOf",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "token",
          "outputs": [
            {
              "internalType": "contract IERC20",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "totalStaked",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "newOwner",
              "type": "address"
            }
          ],
          "name": "transferOwnership",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "undistributed",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "uint256",
              "name": "amount",
              "type": "uint256"
            }
          ],
          "name": "unstake",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "internalType": "uint256",
              "name": "amount",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "nonce",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "deadline",
              "type": "uint256"
            },
            {
              "internalType": "bytes",
              "name": "sig",
              "type": "bytes"
            }
          ],
          "name": "unstakeBySig",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "newImplementation",
              "type": "address"
            },
            {
              "internalType": "bytes",
              "name": "data",
              "type": "bytes"
            }
          ],
          "name": "upgradeToAndCall",
          "outputs": [],
          "stateMutability": "payable",
          "type": "function"
        }
      ]
    },
    "JackTradeToken": {
      "address": "0x10f1fd34d2b3b1b6e5a56b4e08e44d25d9df7a76",
      "abi": [
        {
          "inputs": [],
          "stateMutability": "nonpayable",
          "type": "constructor"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "target",
              "type": "address"
            }
          ],
          "name": "AddressEmptyCode",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "AlreadySet",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "implementation",
              "type": "address"
            }
          ],
          "name": "ERC1967InvalidImplementation",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "ERC1967NonPayable",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "spender",
              "type": "address"
            },
            {
              "internalType": "uint256",
              "name": "allowance",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "needed",
              "type": "uint256"
            }
          ],
          "name": "ERC20InsufficientAllowance",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "sender",
              "type": "address"
            },
            {
              "internalType": "uint256",
              "name": "balance",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "needed",
              "type": "uint256"
            }
          ],
          "name": "ERC20InsufficientBalance",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "approver",
              "type": "address"
            }
          ],
          "name": "ERC20InvalidApprover",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "receiver",
              "type": "address"
            }
          ],
          "name": "ERC20InvalidReceiver",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "sender",
              "type": "address"
            }
          ],
          "name": "ERC20InvalidSender",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "spender",
              "type": "address"
            }
          ],
          "name": "ERC20InvalidSpender",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "FailedCall",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "InvalidInitialization",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "NotInitializing",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "NotMinter",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "owner",
              "type": "address"
            }
          ],
          "name": "OwnableInvalidOwner",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "account",
              "type": "address"
            }
          ],
          "name": "OwnableUnauthorizedAccount",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "TransfersDisabled",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "UUPSUnauthorizedCallContext",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "bytes32",
              "name": "slot",
              "type": "bytes32"
            }
          ],
          "name": "UUPSUnsupportedProxiableUUID",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "ZeroAddress",
          "type": "error"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "owner",
              "type": "address"
            },
            {
              "indexed": true,
              "internalType": "address",
              "name": "spender",
              "type": "address"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "value",
              "type": "uint256"
            }
          ],
          "name": "Approval",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": false,
              "internalType": "uint64",
              "name": "version",
              "type": "uint64"
            }
          ],
          "name": "Initialized",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": false,
              "internalType": "address",
              "name": "minter",
              "type": "address"
            }
          ],
          "name": "MinterSet",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "previousOwner",
              "type": "address"
            },
            {
              "indexed": true,
              "internalType": "address",
              "name": "newOwner",
              "type": "address"
            }
          ],
          "name": "OwnershipTransferStarted",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "previousOwner",
              "type": "address"
            },
            {
              "indexed": true,
              "internalType": "address",
              "name": "newOwner",
              "type": "address"
            }
          ],
          "name": "OwnershipTransferred",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": false,
              "internalType": "address",
              "name": "staking",
              "type": "address"
            }
          ],
          "name": "StakingSet",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "from",
              "type": "address"
            },
            {
              "indexed": true,
              "internalType": "address",
              "name": "to",
              "type": "address"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "value",
              "type": "uint256"
            }
          ],
          "name": "Transfer",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [],
          "name": "TransfersEnabled",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "implementation",
              "type": "address"
            }
          ],
          "name": "Upgraded",
          "type": "event"
        },
        {
          "inputs": [],
          "name": "UPGRADE_INTERFACE_VERSION",
          "outputs": [
            {
              "internalType": "string",
              "name": "",
              "type": "string"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "acceptOwnership",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "owner_",
              "type": "address"
            },
            {
              "internalType": "address",
              "name": "spender",
              "type": "address"
            }
          ],
          "name": "allowance",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "spender",
              "type": "address"
            },
            {
              "internalType": "uint256",
              "name": "value",
              "type": "uint256"
            }
          ],
          "name": "approve",
          "outputs": [
            {
              "internalType": "bool",
              "name": "",
              "type": "bool"
            }
          ],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "account",
              "type": "address"
            }
          ],
          "name": "balanceOf",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "decimals",
          "outputs": [
            {
              "internalType": "uint8",
              "name": "",
              "type": "uint8"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "enableTransfers",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "owner_",
              "type": "address"
            },
            {
              "internalType": "string",
              "name": "name_",
              "type": "string"
            },
            {
              "internalType": "string",
              "name": "symbol_",
              "type": "string"
            }
          ],
          "name": "initialize",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "to",
              "type": "address"
            },
            {
              "internalType": "uint256",
              "name": "amount",
              "type": "uint256"
            }
          ],
          "name": "mint",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "minter",
          "outputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "name",
          "outputs": [
            {
              "internalType": "string",
              "name": "",
              "type": "string"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "owner",
          "outputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "pendingOwner",
          "outputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "proxiableUUID",
          "outputs": [
            {
              "internalType": "bytes32",
              "name": "",
              "type": "bytes32"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "renounceOwnership",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "minter_",
              "type": "address"
            }
          ],
          "name": "setMinter",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "staking_",
              "type": "address"
            }
          ],
          "name": "setStaking",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "staking",
          "outputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "symbol",
          "outputs": [
            {
              "internalType": "string",
              "name": "",
              "type": "string"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "totalSupply",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "to",
              "type": "address"
            },
            {
              "internalType": "uint256",
              "name": "value",
              "type": "uint256"
            }
          ],
          "name": "transfer",
          "outputs": [
            {
              "internalType": "bool",
              "name": "",
              "type": "bool"
            }
          ],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "from",
              "type": "address"
            },
            {
              "internalType": "address",
              "name": "to",
              "type": "address"
            },
            {
              "internalType": "uint256",
              "name": "value",
              "type": "uint256"
            }
          ],
          "name": "transferFrom",
          "outputs": [
            {
              "internalType": "bool",
              "name": "",
              "type": "bool"
            }
          ],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "newOwner",
              "type": "address"
            }
          ],
          "name": "transferOwnership",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "transfersEnabled",
          "outputs": [
            {
              "internalType": "bool",
              "name": "",
              "type": "bool"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "newImplementation",
              "type": "address"
            },
            {
              "internalType": "bytes",
              "name": "data",
              "type": "bytes"
            }
          ],
          "name": "upgradeToAndCall",
          "outputs": [],
          "stateMutability": "payable",
          "type": "function"
        }
      ]
    },
    "JackTradeTokenomics": {
      "address": "0xe7ac6846d9c5ffa92f3e45dd50335c4fe478633d",
      "abi": [
        {
          "inputs": [],
          "stateMutability": "nonpayable",
          "type": "constructor"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "target",
              "type": "address"
            }
          ],
          "name": "AddressEmptyCode",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "implementation",
              "type": "address"
            }
          ],
          "name": "ERC1967InvalidImplementation",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "ERC1967NonPayable",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "FailedCall",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "InvalidCurve",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "InvalidInitialization",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "NotExchange",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "NotInitializing",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "owner",
              "type": "address"
            }
          ],
          "name": "OwnableInvalidOwner",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "account",
              "type": "address"
            }
          ],
          "name": "OwnableUnauthorizedAccount",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "UUPSUnauthorizedCallContext",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "bytes32",
              "name": "slot",
              "type": "bytes32"
            }
          ],
          "name": "UUPSUnsupportedProxiableUUID",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "ZeroAddress",
          "type": "error"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "flatRate",
              "type": "uint256"
            },
            {
              "indexed": false,
              "internalType": "int256",
              "name": "lpFlatThreshold",
              "type": "int256"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "tailDecayScale",
              "type": "uint256"
            }
          ],
          "name": "CurveSet",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": false,
              "internalType": "address",
              "name": "exchange",
              "type": "address"
            }
          ],
          "name": "ExchangeSet",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": false,
              "internalType": "uint64",
              "name": "version",
              "type": "uint64"
            }
          ],
          "name": "Initialized",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "basis",
              "type": "uint256"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "lpAdvance",
              "type": "uint256"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "amount",
              "type": "uint256"
            },
            {
              "indexed": false,
              "internalType": "uint256",
              "name": "tailProgress",
              "type": "uint256"
            }
          ],
          "name": "Minted",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "previousOwner",
              "type": "address"
            },
            {
              "indexed": true,
              "internalType": "address",
              "name": "newOwner",
              "type": "address"
            }
          ],
          "name": "OwnershipTransferStarted",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "previousOwner",
              "type": "address"
            },
            {
              "indexed": true,
              "internalType": "address",
              "name": "newOwner",
              "type": "address"
            }
          ],
          "name": "OwnershipTransferred",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "implementation",
              "type": "address"
            }
          ],
          "name": "Upgraded",
          "type": "event"
        },
        {
          "inputs": [],
          "name": "COLLATERAL_UNIT",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "UPGRADE_INTERFACE_VERSION",
          "outputs": [
            {
              "internalType": "string",
              "name": "",
              "type": "string"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "acceptOwnership",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "int256",
              "name": "trackedLp",
              "type": "int256"
            }
          ],
          "name": "currentRate",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "exchange",
          "outputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "flatRate",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "owner_",
              "type": "address"
            },
            {
              "internalType": "address",
              "name": "token_",
              "type": "address"
            },
            {
              "internalType": "uint256",
              "name": "flatRate_",
              "type": "uint256"
            },
            {
              "internalType": "int256",
              "name": "lpFlatThreshold_",
              "type": "int256"
            },
            {
              "internalType": "uint256",
              "name": "tailDecayScale_",
              "type": "uint256"
            }
          ],
          "name": "initialize",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "lpFlatThreshold",
          "outputs": [
            {
              "internalType": "int256",
              "name": "",
              "type": "int256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "user",
              "type": "address"
            },
            {
              "internalType": "uint256",
              "name": "basis",
              "type": "uint256"
            },
            {
              "internalType": "int256",
              "name": "trackedLpBefore",
              "type": "int256"
            },
            {
              "internalType": "uint256",
              "name": "lpAdvance",
              "type": "uint256"
            }
          ],
          "name": "mintForLoss",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "minted",
              "type": "uint256"
            }
          ],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "owner",
          "outputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "pendingOwner",
          "outputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "proxiableUUID",
          "outputs": [
            {
              "internalType": "bytes32",
              "name": "",
              "type": "bytes32"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "renounceOwnership",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "uint256",
              "name": "flatRate_",
              "type": "uint256"
            },
            {
              "internalType": "int256",
              "name": "lpFlatThreshold_",
              "type": "int256"
            },
            {
              "internalType": "uint256",
              "name": "tailDecayScale_",
              "type": "uint256"
            }
          ],
          "name": "setCurve",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "exchange_",
              "type": "address"
            }
          ],
          "name": "setExchange",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "tailDecayScale",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "tailProgress",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "token",
          "outputs": [
            {
              "internalType": "contract IJackTradeToken",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "newOwner",
              "type": "address"
            }
          ],
          "name": "transferOwnership",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "newImplementation",
              "type": "address"
            },
            {
              "internalType": "bytes",
              "name": "data",
              "type": "bytes"
            }
          ],
          "name": "upgradeToAndCall",
          "outputs": [],
          "stateMutability": "payable",
          "type": "function"
        }
      ]
    },
    "PriceOracle": {
      "address": "0xaed4385e882c823e202d8e34f08dd7cda55e73d9",
      "abi": [
        {
          "inputs": [],
          "stateMutability": "nonpayable",
          "type": "constructor"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "target",
              "type": "address"
            }
          ],
          "name": "AddressEmptyCode",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "implementation",
              "type": "address"
            }
          ],
          "name": "ERC1967InvalidImplementation",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "ERC1967NonPayable",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "FailedCall",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "uint32",
              "name": "instrumentId",
              "type": "uint32"
            }
          ],
          "name": "FeedNotSet",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "uint256",
              "name": "required",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "provided",
              "type": "uint256"
            }
          ],
          "name": "InsufficientFee",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "InvalidConfig",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "InvalidInitialization",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "InvalidPrice",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "NotInitializing",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "owner",
              "type": "address"
            }
          ],
          "name": "OwnableInvalidOwner",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "account",
              "type": "address"
            }
          ],
          "name": "OwnableUnauthorizedAccount",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "ReentrancyGuardReentrantCall",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "RefundFailed",
          "type": "error"
        },
        {
          "inputs": [],
          "name": "UUPSUnauthorizedCallContext",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "bytes32",
              "name": "slot",
              "type": "bytes32"
            }
          ],
          "name": "UUPSUnsupportedProxiableUUID",
          "type": "error"
        },
        {
          "inputs": [
            {
              "internalType": "int32",
              "name": "expo",
              "type": "int32"
            }
          ],
          "name": "UnsupportedExponent",
          "type": "error"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "uint32",
              "name": "instrumentId",
              "type": "uint32"
            },
            {
              "indexed": false,
              "internalType": "bytes32",
              "name": "pythId",
              "type": "bytes32"
            },
            {
              "indexed": false,
              "internalType": "uint32",
              "name": "maxAge",
              "type": "uint32"
            }
          ],
          "name": "FeedSet",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": false,
              "internalType": "uint64",
              "name": "version",
              "type": "uint64"
            }
          ],
          "name": "Initialized",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "previousOwner",
              "type": "address"
            },
            {
              "indexed": true,
              "internalType": "address",
              "name": "newOwner",
              "type": "address"
            }
          ],
          "name": "OwnershipTransferStarted",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "previousOwner",
              "type": "address"
            },
            {
              "indexed": true,
              "internalType": "address",
              "name": "newOwner",
              "type": "address"
            }
          ],
          "name": "OwnershipTransferred",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "implementation",
              "type": "address"
            }
          ],
          "name": "Upgraded",
          "type": "event"
        },
        {
          "inputs": [],
          "name": "MAX_AGE_CAP",
          "outputs": [
            {
              "internalType": "uint32",
              "name": "",
              "type": "uint32"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "UPGRADE_INTERFACE_VERSION",
          "outputs": [
            {
              "internalType": "string",
              "name": "",
              "type": "string"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "acceptOwnership",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "uint32",
              "name": "instrumentId",
              "type": "uint32"
            }
          ],
          "name": "feeds",
          "outputs": [
            {
              "internalType": "bytes32",
              "name": "pythId",
              "type": "bytes32"
            },
            {
              "internalType": "uint32",
              "name": "maxAge",
              "type": "uint32"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "uint32",
              "name": "instrumentId",
              "type": "uint32"
            }
          ],
          "name": "getPrice",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "price",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "conf",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "publishTime",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "bytes[]",
              "name": "updateData",
              "type": "bytes[]"
            }
          ],
          "name": "getUpdateFee",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "uint32",
              "name": "instrumentId",
              "type": "uint32"
            }
          ],
          "name": "hasFeed",
          "outputs": [
            {
              "internalType": "bool",
              "name": "",
              "type": "bool"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "owner_",
              "type": "address"
            },
            {
              "internalType": "address",
              "name": "pyth_",
              "type": "address"
            }
          ],
          "name": "initialize",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "owner",
          "outputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "pendingOwner",
          "outputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "proxiableUUID",
          "outputs": [
            {
              "internalType": "bytes32",
              "name": "",
              "type": "bytes32"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "pyth",
          "outputs": [
            {
              "internalType": "contract IPyth",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "renounceOwnership",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "uint32",
              "name": "instrumentId",
              "type": "uint32"
            },
            {
              "internalType": "bytes32",
              "name": "pythId",
              "type": "bytes32"
            },
            {
              "internalType": "uint32",
              "name": "maxAge",
              "type": "uint32"
            }
          ],
          "name": "setFeed",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "newOwner",
              "type": "address"
            }
          ],
          "name": "transferOwnership",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "bytes[]",
              "name": "updateData",
              "type": "bytes[]"
            }
          ],
          "name": "updatePrices",
          "outputs": [],
          "stateMutability": "payable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "newImplementation",
              "type": "address"
            },
            {
              "internalType": "bytes",
              "name": "data",
              "type": "bytes"
            }
          ],
          "name": "upgradeToAndCall",
          "outputs": [],
          "stateMutability": "payable",
          "type": "function"
        }
      ]
    }
  },
  "eip712": {
    "exchange": {
      "domain": {
        "name": "JackTrade Exchange",
        "version": "1",
        "chainId": 4663,
        "verifyingContract": "0x698cf1a9220f89ccf6ee75269086288a623ede54"
      },
      "types": {
        "Open": [
          {
            "name": "user",
            "type": "address"
          },
          {
            "name": "instrumentId",
            "type": "uint32"
          },
          {
            "name": "isLong",
            "type": "bool"
          },
          {
            "name": "margin",
            "type": "uint256"
          },
          {
            "name": "leverage",
            "type": "uint256"
          },
          {
            "name": "priceLimit",
            "type": "uint256"
          },
          {
            "name": "signedAt",
            "type": "uint256"
          },
          {
            "name": "nonce",
            "type": "uint256"
          }
        ],
        "Close": [
          {
            "name": "user",
            "type": "address"
          },
          {
            "name": "positionId",
            "type": "uint256"
          },
          {
            "name": "priceLimit",
            "type": "uint256"
          },
          {
            "name": "signedAt",
            "type": "uint256"
          },
          {
            "name": "nonce",
            "type": "uint256"
          }
        ],
        "Withdraw": [
          {
            "name": "user",
            "type": "address"
          },
          {
            "name": "to",
            "type": "address"
          },
          {
            "name": "amount",
            "type": "uint256"
          },
          {
            "name": "nonce",
            "type": "uint256"
          },
          {
            "name": "deadline",
            "type": "uint256"
          }
        ]
      }
    },
    "sessionKeys": {
      "domain": {
        "name": "JackTrade SessionKeyManager",
        "version": "1",
        "chainId": 4663,
        "verifyingContract": "0xe82bb6f411a9a53170f9c4fff53207eb80b7bb29"
      },
      "types": {
        "RegisterSessionKey": [
          {
            "name": "user",
            "type": "address"
          },
          {
            "name": "key",
            "type": "address"
          },
          {
            "name": "expiry",
            "type": "uint64"
          },
          {
            "name": "epoch",
            "type": "uint64"
          },
          {
            "name": "nonce",
            "type": "uint256"
          },
          {
            "name": "deadline",
            "type": "uint256"
          }
        ]
      }
    },
    "staking": {
      "domain": {
        "name": "JackTrade Staking",
        "version": "1",
        "chainId": 4663,
        "verifyingContract": "0xbe4fe6490c3feb50bfb347ac5ce641673e25d0bd"
      },
      "types": {
        "Stake": [
          {
            "name": "user",
            "type": "address"
          },
          {
            "name": "amount",
            "type": "uint256"
          },
          {
            "name": "nonce",
            "type": "uint256"
          },
          {
            "name": "deadline",
            "type": "uint256"
          }
        ],
        "Unstake": [
          {
            "name": "user",
            "type": "address"
          },
          {
            "name": "amount",
            "type": "uint256"
          },
          {
            "name": "nonce",
            "type": "uint256"
          },
          {
            "name": "deadline",
            "type": "uint256"
          }
        ],
        "Claim": [
          {
            "name": "user",
            "type": "address"
          },
          {
            "name": "nonce",
            "type": "uint256"
          },
          {
            "name": "deadline",
            "type": "uint256"
          }
        ]
      }
    }
  }
} as const;
