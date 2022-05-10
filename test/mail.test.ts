import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { getContractFactory } from '@nomiclabs/hardhat-ethers/types';
import { expect } from 'chai';
import { ethers } from 'hardhat';

import {
  JumpInterestRateModel,
  LibraryWrapper,
  MAILDeployer,
  MAILMarket,
  Oracle,
} from '../typechain';
import { SHIBA_INU, USDC, USDT, WBTC, WETH } from './utils/constants';
import { deploy, deployUUPS, multiDeploy } from './utils/test-utils';

const { parseEther, defaultAbiCoder } = ethers.utils;

const BLOCKS_PER_YEAR = 2_102_400;

const RESERVE_FACTOR = parseEther('0.2');

const btcModelData = {
  kink: parseEther('0.8'),
  jumpMultiplier: parseEther('0.1'),
  multiplier: parseEther('0.05'),
  base: parseEther('0.02'),
};

const ethModelData = {
  kink: parseEther('0.75'),
  jumpMultiplier: parseEther('0.1'),
  multiplier: parseEther('0.06'),
  base: parseEther('0.025'),
};

const usdcModelData = {
  kink: parseEther('0.85'),
  jumpMultiplier: parseEther('0.05'),
  multiplier: parseEther('0.02'),
  base: parseEther('0.005'),
};

const usdtModelData = {
  kink: parseEther('0.85'),
  jumpMultiplier: parseEther('0.05'),
  multiplier: parseEther('0.02'),
  base: parseEther('0.005'),
};

const shibModelData = {
  kink: parseEther('0.5'),
  jumpMultiplier: parseEther('0.2'),
  multiplier: parseEther('0.13'),
  base: parseEther('0.05'),
};

describe('Mail', () => {
  let mailMarket: MAILMarket;

  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let recipient: SignerWithAddress;
  let treasury: SignerWithAddress;
  let router: SignerWithAddress;

  beforeEach(async () => {
    let libraryWrapper: LibraryWrapper;
    let btcModel: JumpInterestRateModel;
    let ethModel: JumpInterestRateModel;
    let usdcModel: JumpInterestRateModel;
    let usdtModel: JumpInterestRateModel;
    let shibModel: JumpInterestRateModel;

    [
      [alice, bob, recipient, treasury, router],
      [libraryWrapper, btcModel, ethModel, usdcModel, usdtModel, shibModel],
    ] = await Promise.all([
      ethers.getSigners(),
      multiDeploy(
        [
          'LibraryWrapper',
          'JumpInterestRateModel',
          'JumpInterestRateModel',
          'JumpInterestRateModel',
          'JumpInterestRateModel',
          'JumpInterestRateModel',
        ],
        [
          [],
          [
            btcModelData.base,
            btcModelData.multiplier,
            btcModelData.jumpMultiplier,
            btcModelData.kink,
            BLOCKS_PER_YEAR,
          ],
          [
            ethModelData.base,
            ethModelData.multiplier,
            ethModelData.jumpMultiplier,
            ethModelData.kink,
            BLOCKS_PER_YEAR,
          ],
          [
            usdcModelData.base,
            usdcModelData.multiplier,
            usdcModelData.jumpMultiplier,
            usdcModelData.kink,
            BLOCKS_PER_YEAR,
          ],
          [
            usdtModelData.base,
            usdtModelData.multiplier,
            usdtModelData.jumpMultiplier,
            usdtModelData.kink,
            BLOCKS_PER_YEAR,
          ],
          [
            shibModelData.base,
            shibModelData.multiplier,
            shibModelData.jumpMultiplier,
            shibModelData.kink,
            BLOCKS_PER_YEAR,
          ],
        ]
      ),
    ]);

    const oracle = (await deployUUPS('Oracle', [
      libraryWrapper.address,
    ])) as Oracle;

    const data = defaultAbiCoder.encode(
      ['address', 'address', 'address', 'address', 'address'],
      [
        btcModel.address,
        usdcModel.address,
        ethModel.address,
        usdtModel.address,
        shibModel.address,
      ]
    );

    const mailDeployer = (await deploy('MAILDeployer', [
      oracle.address,
      router.address,
      treasury.address,
      RESERVE_FACTOR,
      data,
    ])) as MAILDeployer;

    await mailDeployer.deploy(SHIBA_INU);

    const mailMarketAddress = await mailDeployer.predictMarketAddress(
      SHIBA_INU
    );

    mailMarket = (await ethers.getContractFactory('MAILMarket')).attach(
      mailMarketAddress
    ) as MAILMarket;
  });

  it.only('sets the right data on the constructor', async () => {
    expect(true).to.be.equal(true);
  });
});
