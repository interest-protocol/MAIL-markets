import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers, network } from 'hardhat';

import ERC20ABI from '../abi/erc20.json';
import {
  ERC20,
  JumpInterestRateModel,
  LibraryWrapper,
  MAILDeployer,
  MAILMarket,
  Oracle,
} from '../typechain';
import {
  SHIB_WHALE,
  SHIBA_INU,
  USDC,
  USDC_WHALE,
  USDT,
  USDT_WHALE,
  WBTC,
  WBTC_WHALE,
  WETH,
  WETH_WHALE,
} from './utils/constants';
import {
  advanceBlock,
  advanceBlockAndTime,
  deploy,
  deployUUPS,
  impersonate,
  multiDeploy,
  parseUSDC,
  parseUSDT,
  parseWBTC,
} from './utils/test-utils';

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

const brokenModelData = {
  kink: parseEther('0.001'),
  jumpMultiplier: parseEther('10'),
  multiplier: parseEther('8'),
  base: parseEther('6'),
};

describe('Mail', () => {
  let mailMarket: MAILMarket;
  let mailDeployer: MAILDeployer;

  const shibaInu = new ethers.Contract(
    SHIBA_INU,
    ERC20ABI,
    ethers.provider
  ) as ERC20;
  const wbtc = new ethers.Contract(WBTC, ERC20ABI, ethers.provider) as ERC20;
  const weth = new ethers.Contract(WETH, ERC20ABI, ethers.provider) as ERC20;
  const usdc = new ethers.Contract(USDC, ERC20ABI, ethers.provider) as ERC20;
  const usdt = new ethers.Contract(USDT, ERC20ABI, ethers.provider) as ERC20;

  let btcHolder: SignerWithAddress;
  let shibHolder: SignerWithAddress;
  let wethHolder: SignerWithAddress;
  let usdtHolder: SignerWithAddress;
  let usdcHolder: SignerWithAddress;
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
      [recipient, treasury, router],
      [libraryWrapper, btcModel, ethModel, usdcModel, usdtModel, shibModel],
      btcHolder,
      wethHolder,
      usdcHolder,
      usdtHolder,
      shibHolder,
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
      impersonate(WBTC_WHALE),
      impersonate(WETH_WHALE),
      impersonate(USDC_WHALE),
      impersonate(USDT_WHALE),
      impersonate(SHIB_WHALE),
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

    mailDeployer = (await deploy('MAILDeployer', [
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

    await Promise.all([
      shibaInu
        .connect(shibHolder)
        .approve(mailMarket.address, ethers.constants.MaxUint256),
      wbtc
        .connect(btcHolder)
        .approve(mailMarket.address, ethers.constants.MaxUint256),
      weth
        .connect(wethHolder)
        .approve(mailMarket.address, ethers.constants.MaxUint256),
      usdc
        .connect(usdcHolder)
        .approve(mailMarket.address, ethers.constants.MaxUint256),
      usdt
        .connect(usdtHolder)
        .approve(mailMarket.address, ethers.constants.MaxUint256),
      recipient.sendTransaction({ value: parseEther('2'), to: WBTC_WHALE }),
      recipient.sendTransaction({ value: parseEther('2'), to: WETH_WHALE }),
      recipient.sendTransaction({ value: parseEther('2'), to: USDC_WHALE }),
      recipient.sendTransaction({ value: parseEther('2'), to: USDT_WHALE }),
      recipient.sendTransaction({ value: parseEther('2'), to: SHIB_WHALE }),
      // set up chainlink feeds https://data.chain.link/ethereum/mainnet
      oracle.setFeed(WBTC, '0xdeb288f737066589598e9214e782fa5a8ed689e8'),
      oracle.setFeed(USDC, '0x986b5e1e1755e3c2440e960477f25201b0a8bbd4'),
      oracle.setFeed(USDT, '0xee9f2375b4bdf6387aa8265dd4fb8f16512a1d46'),
    ]);
  });

  it('sets the right data on the constructor', async () => {
    const [pred1, pred2, pred3, pred4, pred5] = await Promise.all([
      mailMarket.isMarket(SHIBA_INU),
      mailMarket.isMarket(WETH),
      mailMarket.isMarket(WBTC),
      mailMarket.isMarket(USDT),
      mailMarket.isMarket(USDC),
    ]);

    expect(pred1).to.be.equal(true);
    expect(pred2).to.be.equal(true);
    expect(pred3).to.be.equal(true);
    expect(pred4).to.be.equal(true);
    expect(pred5).to.be.equal(true);
  });

  it('returns the cash amount of a token in the market', async () => {
    await Promise.all([
      mailMarket
        .connect(shibHolder)
        .deposit(SHIBA_INU, parseEther('5000000'), shibHolder.address),
      mailMarket
        .connect(usdcHolder)
        .deposit(USDC, parseUSDC('10000'), usdcHolder.address),
    ]);

    await mailMarket
      .connect(usdcHolder)
      .borrow(SHIBA_INU, parseEther('5000'), usdcHolder.address);

    const [shibCash, usdcCash] = await Promise.all([
      mailMarket.getCash(SHIBA_INU),
      mailMarket.getCash(USDC),
    ]);

    expect(shibCash).to.be.equal(parseEther('5000000').sub(parseEther('5000')));
    expect(usdcCash).to.be.equal(parseEther('10000'));
  });

  describe('function: getReserves', () => {
    it('reverts if it is not called by the owner', async () => {
      await expect(
        mailMarket.connect(btcHolder).getReserves(WBTC, 0)
      ).to.be.revertedWith('MAIL: only owner');
    });
    it('reverts if you withdraw more than the avaliable reserves', async () => {
      await Promise.all([
        mailMarket.connect(btcHolder).depositReserves(WBTC, parseWBTC('10')),
        mailMarket
          .connect(btcHolder)
          .deposit(WBTC, parseWBTC('2'), btcHolder.address),
      ]);

      await Promise.all([
        expect(
          mailMarket.getReserves(WBTC, parseWBTC('11'))
        ).to.be.revertedWith('MAIL: not enough reserves'),
        expect(
          mailMarket.getReserves(WBTC, parseWBTC('13'))
        ).to.be.revertedWith('MAIL: not enough cash'),
      ]);
    });
    it('reverts if the token is not listed in the market', async () => {
      await expect(
        mailMarket.getReserves(recipient.address, 1)
      ).to.be.revertedWith('MAIL: token not listed');
    });
    it('allows the owner to get the reserves', async () => {
      await mailMarket
        .connect(btcHolder)
        .depositReserves(WBTC, parseWBTC('10'));

      const [wbtcMarket, tresuryBalance] = await Promise.all([
        mailMarket.marketOf(WBTC),
        wbtc.balanceOf(treasury.address),
      ]);

      expect(tresuryBalance).to.be.equal(0);
      expect(wbtcMarket.totalReserves).to.be.equal(parseEther('10'));

      await expect(mailMarket.getReserves(WBTC, parseWBTC('5')))
        .to.emit(mailMarket, 'GetReserves')
        .withArgs(WBTC, treasury.address, parseWBTC('5'))
        .to.emit(wbtc, 'Transfer')
        .withArgs(mailMarket.address, treasury.address, parseWBTC('5'));

      const [wbtcMarket2, tresuryBalance2] = await Promise.all([
        mailMarket.marketOf(WBTC),
        wbtc.balanceOf(treasury.address),
      ]);

      expect(tresuryBalance2).to.be.equal(parseWBTC('5'));
      expect(wbtcMarket2.totalReserves).to.be.equal(parseEther('5'));
    });
  });

  describe('function: depositReserves', () => {
    it('if the token is not listed', async () => {
      await expect(
        mailMarket.connect(btcHolder).depositReserves(treasury.address, 1)
      ).to.revertedWith('MAIL: token not listed');
    });
    it('allows donations to the reserves', async () => {
      expect((await mailMarket.marketOf(WBTC)).totalReserves).to.be.equal(0);

      await expect(
        mailMarket.connect(btcHolder).depositReserves(WBTC, parseWBTC('10'))
      )
        .to.emit(wbtc, 'Transfer')
        .withArgs(btcHolder.address, mailMarket.address, parseWBTC('10'))
        .to.emit(mailMarket, 'DepositReserves')
        .withArgs(WBTC, btcHolder.address, parseWBTC('10'));

      expect((await mailMarket.marketOf(WBTC)).totalReserves).to.be.equal(
        parseEther('10')
      );
    });
  });

  describe('function: accrue', () => {
    it('reverts if the borrow rate is too high', async () => {
      const brokenModel = (await deploy('JumpInterestRateModel', [
        brokenModelData.base,
        brokenModelData.multiplier,
        brokenModelData.jumpMultiplier,
        brokenModelData.kink,
        BLOCKS_PER_YEAR,
      ])) as JumpInterestRateModel;

      await mailDeployer.setInterestRateModel(USDC, brokenModel.address);

      await Promise.all([
        mailMarket
          .connect(btcHolder)
          .deposit(WBTC, parseWBTC('10'), btcHolder.address),
        mailMarket
          .connect(usdcHolder)
          .deposit(USDC, parseUSDC('10000'), btcHolder.address),
      ]);

      await mailMarket
        .connect(btcHolder)
        .borrow(USDC, parseUSDC('7000'), btcHolder.address);

      await advanceBlock(ethers);

      await expect(mailMarket.accrue(USDC)).to.be.revertedWith(
        'MAIL: borrow rate too high'
      );
    });
    it('reverts if you try to accrue a non listed token', async () => {
      await expect(mailMarket.accrue(btcHolder.address)).to.be.revertedWith(
        'MAIL: token not listed'
      );
    });
    it('does not accrue if there are no open loans', async () => {
      await mailMarket
        .connect(btcHolder)
        .deposit(WBTC, parseWBTC('10'), btcHolder.address);

      await expect(mailMarket.accrue(WBTC)).to.not.emit(mailMarket, 'Accrue');

      const loan = await mailMarket.marketOf(WBTC);

      await expect(mailMarket.accrue(WBTC)).to.not.emit(mailMarket, 'Accrue');

      const loan2 = await mailMarket.marketOf(WBTC);

      expect(loan.lastAccruedBlock.lt(loan2.lastAccruedBlock)).to.be.equal(
        true
      );
    });
    it('does not accrue if it is called in the same block', async () => {
      await network.provider.send('evm_setAutomine', [false]);

      await Promise.all([
        mailMarket
          .connect(btcHolder)
          .deposit(WBTC, parseWBTC('10'), btcHolder.address),
        mailMarket
          .connect(usdcHolder)
          .deposit(USDC, parseUSDC('20000'), usdcHolder.address),
      ]);

      await advanceBlock(ethers);

      await mailMarket
        .connect(btcHolder)
        .borrow(USDC, parseUSDC('10000'), btcHolder.address);

      await advanceBlock(ethers);

      await advanceBlockAndTime(50_000, ethers);

      const receipt = await mailMarket.accrue(USDC);
      const receipt2 = await mailMarket.accrue(USDC);

      await advanceBlock(ethers);

      const [awaitedReceipt, awaitedReceipt2] = await Promise.all([
        receipt.wait(),
        receipt2.wait(),
      ]);

      expect(
        awaitedReceipt.events?.filter((x) => x.event === 'Accrue').length
      ).to.be.equal(1);

      expect(
        awaitedReceipt2.events?.filter((x) => x.event === 'Accrue').length
      ).to.be.equal(0);

      await network.provider.send('evm_setAutomine', [true]);
    });
    it('accrues', async () => {
      await Promise.all([
        mailMarket
          .connect(btcHolder)
          .deposit(WBTC, parseWBTC('10'), btcHolder.address),
        mailMarket
          .connect(usdcHolder)
          .deposit(USDC, parseUSDC('10000'), usdcHolder.address),
      ]);

      await mailMarket
        .connect(btcHolder)
        .borrow(USDC, parseUSDC('5000'), btcHolder.address);

      await advanceBlock(ethers);

      const market = await mailMarket.marketOf(USDC);

      await expect(mailMarket.accrue(USDC)).to.emit(mailMarket, 'Accrue');

      const market2 = await mailMarket.marketOf(USDC);

      expect(market2.lastAccruedBlock.gt(market.lastAccruedBlock)).to.be.equal(
        true
      );
      expect(market2.loan.base.gt(market.loan.base)).to.be.equal(true);
      expect(market2.loan.elastic.gt(market.loan.elastic)).to.be.equal(true);
      expect(market2.totalReserves.gt(market.totalReserves)).to.be.equal(true);
      expect(
        market2.totalRewardsPerToken.gt(market.totalRewardsPerToken)
      ).to.be.equal(true);
    });
  });
});
