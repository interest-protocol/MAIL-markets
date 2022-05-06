import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';

import {
  MockChainLinkFeed,
  MockERC20,
  MockERC209Decimals,
  MockERC2020Decimals,
  MockLibraryWrapper,
  MockMailDeployer,
  MockUniswapFactoryV3,
  Oracle,
} from '../typechain';
import { deployUUPS, multiDeploy } from './utils/test-utils';

const { parseEther } = ethers.utils;

describe('Oracle', () => {
  let oracle: Oracle;
  let uniswapFactory: MockUniswapFactoryV3;
  let libraryWrapper: MockLibraryWrapper;
  let wethFeed: MockChainLinkFeed;
  let btcFeed: MockChainLinkFeed;
  let tokenAFeed: MockChainLinkFeed;
  let mailDeployer: MockMailDeployer;

  let WETH: MockERC20;
  let BTC: MockERC20;
  let tokenA9Decimals: MockERC209Decimals;
  let riskyAsset: MockERC20;
  let riskyAsset9Decimals: MockERC209Decimals;
  let bigToken: MockERC2020Decimals;

  let owner: SignerWithAddress;
  let alice: SignerWithAddress;

  beforeEach(async () => {
    [
      [owner, alice],
      [
        WETH,
        BTC,
        tokenA9Decimals,
        riskyAsset,
        riskyAsset9Decimals,
        bigToken,
        wethFeed,
        btcFeed,
        tokenAFeed,
      ],
    ] = await Promise.all([
      ethers.getSigners(),
      multiDeploy(
        [
          'MockERC20',
          'MockERC20',
          'MockERC209Decimals',
          'MockERC20',
          'MockERC209Decimals',
          'MockERC2020Decimals',
          'MockChainLinkFeed',
          'MockChainLinkFeed',
          'MockChainLinkFeed',
        ],
        [
          ['Wrapped Ethereum', 'WETH', 0],
          ['Bitcoin', 'BTC', 0],
          ['Token A', 'TA', 0],
          ['BunnyPark', 'BP', 0],
          ['Safemoon', 'SFM', 0],
          ['Big Token A', 'BTA', 0],
          [8, 'WETH/USD', 1],
          [8, 'BTC/USD', 1],
          [18, 'TOKENA/USD', 1],
        ]
      ),
    ]);
  });
});
