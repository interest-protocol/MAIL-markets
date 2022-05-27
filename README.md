# :seedling: Welcome to Interest Protocol! :seedling:

[![codecov](https://codecov.io/gh/interest-protocol/MAIL-markets/branch/main/graph/badge.svg?token=QG60PJCVVJ)](https://codecov.io/gh/interest-protocol/MAIL-markets)
[![docs](./assets/gitbook_2.svg)](https://docs.interestprotocol.com/)
[![twitter](./assets/twitter.svg)](https://twitter.com/interest_dinero)
[![discord](./assets/discord.svg)](https://discord.gg/PJEkqM4Crk)
[![reddit](./assets/reddit.svg)](https://www.reddit.com/user/InterestProtocol)

MAIL Markets are lending markets based on Uniswap V3 Pairs. 

A MAIL (Multi-Asset-Isolated-Lending) market can be launched by anyone by selecting a token with a token/ETH pair on UniswapV3 without a MAIL market.

However, it requires the pair to have trading activity because the UniswapV3 oracle is set to use a 24 hour TWAP.

*Note* The price of the risky asset is based on a TWAP to be resistant to manipulations.

## How to use

If a token does not have a market and has a ETH pair in UniswapV3, you can launch the market using the MAILDeployer. 

## :money_with_wings: Features :money_with_wings:

- Token agnostic: borrow and/or lend any token with a UniswapV3 ETH pair
- Bridge assets: each market supports ETH, BTC, USDT, USDC and the selected token from the pair
- Isolated Architecture: each market is separated from each other, protecting the users from harmful tokens
- (WIP) Router: Markets can lend from each other via the bridge assets they have in common

## :fire: Technology :fire:

Core technologies:

- [Typescript](https://www.typescriptlang.org/)
- [Hardhat](https://hardhat.org/)
- [Solidity](https://docs.soliditylang.org/)

> :warning: **If your node runs out of memory write in your terminal `export NODE_OPTIONS="--max-old-space-size=8192" `**

## Bridge Assets

They are the common tokens between all MAIL markets:
Their price comes directly from Chainlink and not UniswapV3.

- BTC
- ETH
- USDC 
- USDT

## Social Media

**Get in touch!**

- info@interestprotocol.com
- [Twitter](https://twitter.com/interest_dinero)
- [Medium](https://medium.com/@interestprotocol)
- [Reddit](https://www.reddit.com/user/InterestProtocol)
- [Telegram](https://t.me/interestprotocol)
- [Discord](https://discord.gg/PJEkqM4Crk)
