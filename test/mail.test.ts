import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { ethers, network } from 'hardhat';

import ERC20ABI from '../abi/erc20.json';
import {
  ERC20,
  JumpInterestRateModel,
  LibraryWrapper,
  MAILDeployer,
  MAILMarket,
  MockChainLinkFeed,
  Oracle,
} from '../typechain';
import {
  ADD_COLLATERAL_REQUEST,
  BORROW_REQUEST,
  REPAY_REQUEST,
  SHIB_WHALE,
  SHIBA_INU,
  USDC,
  USDC_WHALE,
  USDT,
  USDT_WHALE,
  WBTC,
  WBTC_WHALE,
  WBTC_WHALE_2,
  WETH,
  WETH_WHALE,
  WITHDRAW_COLLATERAL_REQUEST,
} from './utils/constants';
import {
  advanceBlock,
  advanceBlockAndTime,
  deploy,
  deployUUPS,
  impersonate,
  multiDeploy,
  parseUSDC,
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

// BigNumber { value: "13297486710000000000" } wbtcPrice
// BigNumber { value: "368171490000000" } usdcPrice
// BigNumber { value: "7337530445" } shibPrice
// 1 ETH ~ 2717 USD

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

  let owner: SignerWithAddress;
  let btcHolder: SignerWithAddress;
  let shibHolder: SignerWithAddress;
  let wethHolder: SignerWithAddress;
  let usdtHolder: SignerWithAddress;
  let usdcHolder: SignerWithAddress;
  let recipient: SignerWithAddress;
  let treasury: SignerWithAddress;
  let router: SignerWithAddress;
  let oracle: Oracle;

  // Interest rate models
  let btcModel: JumpInterestRateModel;
  let ethModel: JumpInterestRateModel;
  let usdcModel: JumpInterestRateModel;
  let usdtModel: JumpInterestRateModel;
  let shibModel: JumpInterestRateModel;

  beforeEach(async () => {
    let libraryWrapper: LibraryWrapper;

    [
      [owner, recipient, treasury, router],
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

    oracle = await deployUUPS('Oracle', [libraryWrapper.address]);

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

      await network.provider.send('evm_setAutomine', [false]);

      await advanceBlock(ethers);

      const market = await mailMarket.marketOf(USDC);

      await advanceBlock(ethers);
      await advanceBlock(ethers);
      await advanceBlock(ethers);
      await advanceBlock(ethers);

      await mailMarket.accrue(USDC);

      await advanceBlock(ethers);

      const market2 = await mailMarket.marketOf(USDC);

      await advanceBlock(ethers);

      const blockDelta = market2.lastAccruedBlock.sub(market.lastAccruedBlock);
      const cash = await mailMarket.getCash(USDC);

      const [borrowRatePerBlock, supplyRatePerBlock] = await Promise.all([
        usdcModel.getBorrowRatePerBlock(
          cash,
          market.loan.elastic,
          market.totalReserves
        ),
        usdcModel.getSupplyRatePerBlock(
          cash,
          market.loan.elastic,
          market.totalReserves,
          RESERVE_FACTOR
        ),
      ]);

      const newDebt = blockDelta
        .mul(borrowRatePerBlock)
        .mul(market.loan.elastic)
        .div(parseEther('1'));

      const newRewards = blockDelta
        .mul(supplyRatePerBlock)
        .mul(market.loan.elastic)
        .div(parseEther('1'));

      const newLoan = {
        base: market.loan.base,
        elastic: market.loan.elastic.add(newDebt),
      };

      expect(market2.lastAccruedBlock.gt(market.lastAccruedBlock)).to.be.equal(
        true
      );
      expect(market2.loan.base).to.be.equal(newLoan.base);
      expect(market2.loan.elastic).to.be.equal(newLoan.elastic);
      expect(market2.totalReserves).to.be.equal(
        market.totalReserves.add(newDebt.sub(newRewards))
      );
      expect(market2.totalRewardsPerToken).to.be.equal(
        market.totalRewardsPerToken.add(
          newRewards.mul(parseEther('1')).div(parseEther('10000'))
        )
      );

      await network.provider.send('evm_setAutomine', [true]);
    });
  });

  describe('function: deposit', () => {
    it('reverts if the token is not supported', async () => {
      await expect(
        mailMarket.deposit(recipient.address, 1, recipient.address)
      ).to.be.revertedWith('MAIL: token not listed');
    });
    it('reverts if the arguments are invalid', async () => {
      await Promise.all([
        expect(
          mailMarket.connect(btcHolder).deposit(WBTC, 0, btcHolder.address)
        ).to.be.revertedWith('MAIL: no zero deposits'),
        expect(
          mailMarket
            .connect(btcHolder)
            .deposit(WBTC, 1, ethers.constants.AddressZero)
        ).to.be.revertedWith('MAIL: no zero address deposits'),
      ]);
    });
    it('does not give rewards if there are none', async () => {
      const [wbtcTotalSupply, btcHolderAccount, wbtcMarket] = await Promise.all(
        [
          mailMarket.totalSupplyOf(WBTC),
          mailMarket.accountOf(WBTC, btcHolder.address),
          mailMarket.marketOf(WBTC),
        ]
      );

      await expect(
        mailMarket
          .connect(btcHolder)
          .deposit(WBTC, parseWBTC('10'), btcHolder.address)
      )
        .to.emit(mailMarket, 'Deposit')
        .withArgs(
          btcHolder.address,
          btcHolder.address,
          WBTC,
          parseWBTC('10'),
          0
        );

      const [wbtcTotalSupply2, btcHolderAccount2, wbtcMarket2] =
        await Promise.all([
          mailMarket.totalSupplyOf(WBTC),
          mailMarket.accountOf(WBTC, btcHolder.address),
          mailMarket.marketOf(WBTC),
        ]);

      // Pre-deposit
      expect(wbtcTotalSupply).to.be.equal(0);
      expect(btcHolderAccount.rewardDebt).to.be.equal(0);
      expect(btcHolderAccount.balance).to.be.equal(0);
      expect(btcHolderAccount.principal).to.be.equal(0);
      expect(wbtcMarket.totalReserves).to.be.equal(0);
      expect(wbtcMarket.totalRewardsPerToken).to.be.equal(0);
      expect(wbtcMarket.loan.base).to.be.equal(0);
      expect(wbtcMarket.loan.elastic).to.be.equal(0);

      // Post 10 WBTC deposit
      expect(wbtcTotalSupply2).to.be.equal(parseEther('10'));
      expect(btcHolderAccount2.rewardDebt).to.be.equal(0);
      expect(btcHolderAccount2.balance).to.be.equal(parseEther('10'));
      expect(btcHolderAccount2.principal).to.be.equal(0);
      expect(wbtcMarket2.totalReserves).to.be.equal(0);
      expect(wbtcMarket2.totalRewardsPerToken).to.be.equal(0);
      expect(wbtcMarket2.loan.base).to.be.equal(0);
      expect(wbtcMarket2.loan.elastic).to.be.equal(0);
    });
    it('properly calculates rewards', async () => {
      const btcHolder2 = await impersonate(WBTC_WHALE_2);

      await wbtc
        .connect(btcHolder2)
        .approve(mailMarket.address, ethers.constants.MaxUint256);

      await expect(
        mailMarket
          .connect(btcHolder)
          .deposit(WBTC, parseWBTC('10'), btcHolder.address)
      )
        .to.emit(mailMarket, 'Deposit')
        .withArgs(
          btcHolder.address,
          btcHolder.address,
          WBTC,
          parseWBTC('10'),
          0
        );

      await expect(
        mailMarket
          .connect(btcHolder2)
          .deposit(WBTC, parseWBTC('5'), btcHolder2.address)
      )
        .to.emit(mailMarket, 'Deposit')
        .withArgs(
          btcHolder2.address,
          btcHolder2.address,
          WBTC,
          parseWBTC('5'),
          0
        );

      await expect(
        mailMarket
          .connect(usdcHolder)
          .deposit(USDC, parseUSDC('1000000'), usdcHolder.address)
      );

      await mailMarket
        .connect(usdcHolder)
        .borrow(WBTC, parseWBTC('5'), usdcHolder.address);

      await network.provider.send('hardhat_mine', [
        `0x${Number(10).toString(16)}`,
      ]);

      await network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x0']);

      await mailMarket.accrue(WBTC);

      await mailMarket
        .connect(btcHolder)
        .deposit(WBTC, parseWBTC('1'), btcHolder.address);

      const [wbtcTotalSupply, btcHolderAccount, btcHolder2Account, wbtcMarket] =
        await Promise.all([
          mailMarket.totalSupplyOf(WBTC),
          mailMarket.accountOf(WBTC, btcHolder.address),
          mailMarket.accountOf(WBTC, btcHolder2.address),
          mailMarket.marketOf(WBTC),
        ]);

      // 16 deposited plus the supply
      expect(wbtcTotalSupply).to.be.closeTo(
        parseEther('16').add(
          btcHolderAccount.balance
            .sub(parseEther('1'))
            .mul(wbtcMarket.totalRewardsPerToken)
            .div(parseEther('1'))
        ),
        parseEther('0.0000000001')
      );
      expect(btcHolderAccount.principal).to.be.equal(0);
      expect(btcHolderAccount.balance).to.closeTo(
        parseEther('11').add(
          btcHolderAccount.balance
            .sub(parseEther('1'))
            .mul(wbtcMarket.totalRewardsPerToken)
            .div(parseEther('1'))
        ),
        parseEther('0.0000000001')
      );
      expect(btcHolderAccount.rewardDebt).to.be.equal(
        btcHolderAccount.balance
          .mul(wbtcMarket.totalRewardsPerToken)
          .div(parseEther('1'))
      );
      expect(btcHolder2Account.principal).to.be.equal(0);
      expect(btcHolder2Account.balance).to.be.equal(parseEther('5'));
      expect(btcHolder2Account.rewardDebt).to.be.equal(0);

      await mailMarket
        .connect(btcHolder2)
        .deposit(WBTC, parseWBTC('1'), btcHolder2.address);

      const [
        wbtcTotalSupply2,
        btcHolderAccount2,
        btcHolder2Account2,
        wbtcMarket2,
      ] = await Promise.all([
        mailMarket.totalSupplyOf(WBTC),
        mailMarket.accountOf(WBTC, btcHolder.address),
        mailMarket.accountOf(WBTC, btcHolder2.address),
        mailMarket.marketOf(WBTC),
      ]);

      // 16 deposited plus the supply
      expect(wbtcTotalSupply2).to.be.closeTo(
        wbtcTotalSupply
          .add(
            wbtcMarket2.totalRewardsPerToken
              .mul(btcHolder2Account2.balance.sub(parseEther('1')))
              .div(parseEther('1'))
          )
          .add(parseEther('1')),
        parseEther('0.0000000001')
      );
      expect(btcHolderAccount2.principal).to.be.equal(0);
      expect(btcHolderAccount2.balance).to.equal(btcHolderAccount.balance);
      expect(btcHolderAccount2.rewardDebt).to.be.equal(
        btcHolderAccount.rewardDebt
      );
      expect(btcHolder2Account2.principal).to.be.equal(0);
      expect(btcHolder2Account2.balance).to.be.closeTo(
        btcHolder2Account.balance
          .add(parseEther('1'))
          .add(
            wbtcMarket2.totalRewardsPerToken
              .mul(btcHolder2Account2.balance.sub(parseEther('1')))
              .div(parseEther('1'))
          ),
        parseEther('0.0000000001')
      );
      expect(btcHolder2Account2.rewardDebt).to.be.equal(
        wbtcMarket2.totalRewardsPerToken
          .mul(btcHolder2Account2.balance)
          .div(parseEther('1'))
      );
    });
  });

  describe('function: withdraw', () => {
    it('reverts if the token is not listed', async () => {
      await expect(
        mailMarket.withdraw(recipient.address, 0, recipient.address)
      ).to.be.revertedWith('MAIL: token not listed');
    });
    it('reverts if the arguments are invalid', async () => {
      await Promise.all([
        expect(
          mailMarket.connect(btcHolder).withdraw(WBTC, 0, btcHolder.address)
        ).to.be.revertedWith('MAIL: no zero withdraws'),
        expect(
          mailMarket
            .connect(btcHolder)
            .withdraw(WBTC, 1, ethers.constants.AddressZero)
        ).to.be.revertedWith('MAIL: no zero address'),
      ]);
    });
    it('calls accrue on withdrawals if there is a loan', async () => {
      await Promise.all([
        mailMarket
          .connect(btcHolder)
          .deposit(WBTC, parseWBTC('10'), btcHolder.address),
        mailMarket
          .connect(usdcHolder)
          .deposit(USDC, parseUSDC('100000'), usdcHolder.address),
      ]);

      await advanceBlock(ethers);

      // no borrows so it does not accrue
      await expect(
        mailMarket
          .connect(btcHolder)
          .withdraw(WBTC, parseWBTC('1'), btcHolder.address)
      ).to.not.emit(mailMarket, 'Accrue');

      await mailMarket
        .connect(usdcHolder)
        .borrow(WBTC, parseWBTC('1'), usdcHolder.address);

      await advanceBlock(ethers);

      await expect(
        mailMarket
          .connect(btcHolder)
          .withdraw(WBTC, parseWBTC('1'), btcHolder.address)
      ).to.emit(mailMarket, 'Accrue');
    });
    it('reverts if there is not enough cash', async () => {
      await Promise.all([
        mailMarket
          .connect(btcHolder)
          .deposit(WBTC, parseWBTC('10'), btcHolder.address),
        mailMarket
          .connect(usdcHolder)
          .deposit(USDC, parseUSDC('1000000'), usdcHolder.address),
      ]);

      await mailMarket
        .connect(usdcHolder)
        .borrow(WBTC, parseWBTC('2'), usdcHolder.address);

      await expect(
        mailMarket
          .connect(btcHolder)
          .withdraw(WBTC, parseWBTC('9'), btcHolder.address)
      ).to.be.revertedWith('MAIL: not enough cash');
    });

    it('allows withdraws', async () => {
      const btcHolder2 = await impersonate(WBTC_WHALE_2);

      await wbtc
        .connect(btcHolder2)
        .approve(mailMarket.address, ethers.constants.MaxUint256);

      await Promise.all([
        mailMarket
          .connect(btcHolder)
          .deposit(WBTC, parseWBTC('10'), btcHolder.address),
        mailMarket
          .connect(btcHolder2)
          .deposit(WBTC, parseWBTC('5'), btcHolder2.address),
        mailMarket
          .connect(usdcHolder)
          .deposit(USDC, parseUSDC('2000000'), usdcHolder.address),
      ]);

      await mailMarket
        .connect(usdcHolder)
        .borrow(WBTC, parseWBTC('3'), usdcHolder.address);

      await network.provider.send('hardhat_mine', [
        `0x${Number(10).toString(16)}`,
      ]);

      await network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x0']);

      const [
        wbtcTotalSupply,
        wbtcMarket,
        btcHolderAccount,
        btcHolder2Account,
        btcHolderWBTCBalance,
      ] = await Promise.all([
        mailMarket.totalSupplyOf(WBTC),
        mailMarket.marketOf(WBTC),
        mailMarket.accountOf(WBTC, btcHolder.address),
        mailMarket.accountOf(WBTC, btcHolder2.address),
        wbtc.balanceOf(btcHolder.address),
      ]);

      expect(wbtcTotalSupply).to.be.equal(parseEther('15'));
      expect(wbtcMarket.totalRewardsPerToken).to.be.equal(0);
      expect(wbtcMarket.totalReserves).to.be.equal(0);
      expect(wbtcMarket.loan.base).to.be.equal(parseEther('3'));
      expect(wbtcMarket.loan.elastic).to.be.equal(parseEther('3'));

      expect(btcHolderAccount.rewardDebt).to.be.equal(0);
      expect(btcHolderAccount.balance).to.be.equal(parseEther('10'));
      expect(btcHolderAccount.principal).to.be.equal(0);

      expect(btcHolder2Account.rewardDebt).to.be.equal(0);
      expect(btcHolder2Account.balance).to.be.equal(parseEther('5'));
      expect(btcHolder2Account.principal).to.be.equal(0);

      await expect(
        mailMarket
          .connect(btcHolder)
          .withdraw(WBTC, parseWBTC('5'), btcHolder.address)
      )
        .to.emit(mailMarket, 'Accrue')
        .to.emit(mailMarket, 'Withdraw')
        .to.emit(wbtc, 'Transfer');

      const [
        wbtcTotalSupply2,
        wbtcMarket2,
        btcHolderAccount2,
        btcHolder2Account2,
        btcHolderWBTCBalance2,
        btcHolder2WBTCBalance2,
      ] = await Promise.all([
        mailMarket.totalSupplyOf(WBTC),
        mailMarket.marketOf(WBTC),
        mailMarket.accountOf(WBTC, btcHolder.address),
        mailMarket.accountOf(WBTC, btcHolder2.address),
        wbtc.balanceOf(btcHolder.address),
        wbtc.balanceOf(btcHolder2.address),
      ]);

      expect(wbtcTotalSupply2).to.be.equal(parseEther('10'));

      expect(btcHolderAccount2.rewardDebt).to.be.equal(
        wbtcMarket2.totalRewardsPerToken
          .mul(btcHolderAccount2.balance)
          .div(parseEther('1'))
      );
      // Rewards re sent
      expect(btcHolderWBTCBalance2).to.be.closeTo(
        btcHolderWBTCBalance
          .add(
            wbtcMarket2.totalRewardsPerToken
              .mul(parseEther('15'))
              .div(parseEther('1'))
              .div(parseWBTC('1'))
          )
          .add(parseWBTC('5')),
        10_000
      );

      expect(btcHolderAccount2.balance).to.be.equal(parseEther('5'));
      expect(btcHolderAccount2.principal).to.be.equal(0);
      expect(btcHolder2Account2.rewardDebt).to.be.equal(0);
      expect(btcHolder2Account2.balance).to.be.equal(parseEther('5'));
      expect(btcHolder2Account2.principal).to.be.equal(0);

      mailMarket
        .connect(btcHolder2)
        .withdraw(WBTC, parseWBTC('5'), btcHolder2.address);

      const [
        wbtcTotalSupply3,
        wbtcMarket3,
        btcHolderAccount3,
        btcHolder2Account3,
        btcHolder2WBTCBalance3,
      ] = await Promise.all([
        mailMarket.totalSupplyOf(WBTC),
        mailMarket.marketOf(WBTC),
        mailMarket.accountOf(WBTC, btcHolder.address),
        mailMarket.accountOf(WBTC, btcHolder2.address),
        wbtc.balanceOf(btcHolder2.address),
      ]);

      expect(wbtcTotalSupply3).to.be.equal(
        wbtcTotalSupply2.sub(parseEther('5'))
      );
      expect(btcHolderAccount3.balance).to.be.equal(btcHolderAccount2.balance);
      expect(btcHolderAccount3.rewardDebt).to.be.equal(
        btcHolderAccount2.rewardDebt
      );
      expect(btcHolderAccount3.principal).to.be.equal(
        btcHolderAccount2.principal
      );

      expect(btcHolder2Account3.balance).to.be.equal(0);
      expect(btcHolder2Account3.rewardDebt).to.be.equal(0);
      expect(btcHolder2Account3.principal).to.be.equal(0);
      expect(btcHolder2WBTCBalance3).to.be.closeTo(
        btcHolder2WBTCBalance2
          .add(parseWBTC('5'))
          .add(
            wbtcMarket3.totalRewardsPerToken
              .mul(parseEther('5'))
              .div(parseEther('1'))
              .div(parseWBTC('1'))
          ),
        10_000
      );
    });
  });

  describe('function: borrow', () => {
    it('reverts if the token is not listed', async () => {
      await expect(
        mailMarket
          .connect(btcHolder)
          .borrow(recipient.address, 1, recipient.address)
      ).to.be.revertedWith('MAIL: token not listed');
    });

    it('does not allow to borrow if you are not solvent', async () => {
      await Promise.all([
        mailMarket
          .connect(btcHolder)
          .deposit(WBTC, parseWBTC('1'), btcHolder.address),
        mailMarket
          .connect(usdcHolder)
          .deposit(USDC, parseUSDC('50000'), btcHolder.address),
        mailMarket
          .connect(wethHolder)
          .deposit(WETH, parseEther('100'), wethHolder.address),
      ]);

      await expect(
        mailMarket
          .connect(btcHolder)
          .borrow(WETH, parseEther('16'), btcHolder.address)
      ).to.be.revertedWith('MAIL: account is insolvent');
    });

    it('calls accrue if there is an open loan', async () => {
      await Promise.all([
        mailMarket
          .connect(btcHolder)
          .deposit(WBTC, parseWBTC('1'), btcHolder.address),
        mailMarket
          .connect(usdcHolder)
          .deposit(USDC, parseUSDC('50000'), btcHolder.address),
      ]);

      await expect(
        mailMarket
          .connect(btcHolder)
          .borrow(USDC, parseUSDC('5000'), btcHolder.address)
      ).to.not.emit(mailMarket, 'Accrue');

      await expect(
        mailMarket
          .connect(btcHolder)
          .borrow(USDC, parseUSDC('5000'), btcHolder.address)
      ).to.emit(mailMarket, 'Accrue');
    });

    it('reverts if the amount is 0 or there is not enough cash', async () => {
      await Promise.all([
        mailMarket
          .connect(btcHolder)
          .deposit(WBTC, parseWBTC('10'), btcHolder.address),
        mailMarket
          .connect(usdcHolder)
          .deposit(USDC, parseUSDC('5000'), btcHolder.address),
      ]);

      await Promise.all([
        expect(
          mailMarket.connect(btcHolder).borrow(USDC, 0, btcHolder.address)
        ).to.be.revertedWith('MAIL: no zero withdraws'),
        expect(
          mailMarket
            .connect(btcHolder)
            .borrow(USDC, parseUSDC('5500'), btcHolder.address)
        ).to.be.revertedWith('MAIL: not enough cash'),
      ]);
    });

    it('allows borrows', async () => {
      await Promise.all([
        mailMarket
          .connect(btcHolder)
          .deposit(WBTC, parseWBTC('10'), btcHolder.address),
        mailMarket
          .connect(usdcHolder)
          .deposit(USDC, parseUSDC('50000'), usdcHolder.address),
      ]);

      const [btcHolderUSDCAccount, usdcMarket] = await Promise.all([
        mailMarket.accountOf(USDC, btcHolder.address),
        mailMarket.marketOf(USDC),
      ]);

      expect(btcHolderUSDCAccount.principal).to.be.equal(0);
      expect(btcHolderUSDCAccount.balance).to.be.equal(0);
      expect(btcHolderUSDCAccount.rewardDebt).to.be.equal(0);
      expect(usdcMarket.loan.elastic).to.be.equal(0);
      expect(usdcMarket.loan.base).to.be.equal(0);

      await expect(
        mailMarket
          .connect(btcHolder)
          .borrow(USDC, parseUSDC('10000'), btcHolder.address)
      )
        .to.emit(mailMarket, 'Borrow')
        .withArgs(
          btcHolder.address,
          btcHolder.address,
          USDC,
          parseUSDC('10000'),
          parseUSDC('10000')
        )
        .to.emit(usdc, 'Transfer')
        .withArgs(mailMarket.address, btcHolder.address, parseUSDC('10000'));

      const [btcHolderUSDCAccount2, usdcMarket2] = await Promise.all([
        mailMarket.accountOf(USDC, btcHolder.address),
        mailMarket.marketOf(USDC),
      ]);

      expect(btcHolderUSDCAccount2.principal).to.be.equal(parseEther('10000'));
      expect(btcHolderUSDCAccount2.balance).to.be.equal(0);
      expect(btcHolderUSDCAccount2.rewardDebt).to.be.equal(0);
      expect(usdcMarket2.loan.elastic).to.be.equal(parseEther('10000'));
      expect(usdcMarket2.loan.base).to.be.equal(parseEther('10000'));

      await mailMarket
        .connect(btcHolder)
        .borrow(USDC, parseUSDC('20000'), btcHolder.address);

      const [btcHolderUSDCAccount3, usdcMarket3] = await Promise.all([
        mailMarket.accountOf(USDC, btcHolder.address),
        mailMarket.marketOf(USDC),
      ]);

      expect(btcHolderUSDCAccount3.principal).to.be.equal(
        usdcMarket3.loan.base
      );
      expect(btcHolderUSDCAccount3.balance).to.be.equal(0);
      expect(btcHolderUSDCAccount3.rewardDebt).to.be.equal(0);
      // accrued some interest
      expect(
        usdcMarket3.loan.elastic.gt(
          usdcMarket2.loan.elastic.add(parseEther('20000'))
        )
      ).to.be.equal(true);
      // We calculated the proper fees on the accrue function
      expect(
        usdcMarket3.loan.base.gt(usdcMarket2.loan.base) &&
          usdcMarket3.loan.base.lt(parseEther('30000'))
      ).to.be.equal(true);
    });
  });

  describe('function: repay', () => {
    it('reverts if the market is not listed', async () => {
      await expect(
        mailMarket.repay(recipient.address, 0, recipient.address)
      ).to.be.revertedWith('MAIL: token not listed');
    });

    it('it accrues', async () => {
      await Promise.all([
        mailMarket
          .connect(btcHolder)
          .deposit(WBTC, parseWBTC('10'), btcHolder.address),
        mailMarket
          .connect(usdcHolder)
          .deposit(USDC, parseUSDC('100000'), usdcHolder.address),
        usdc
          .connect(usdcHolder)
          .transfer(btcHolder.address, parseUSDC('20000')),
        usdc
          .connect(btcHolder)
          .approve(mailMarket.address, ethers.constants.MaxUint256),
      ]);

      await mailMarket
        .connect(btcHolder)
        .borrow(USDC, parseUSDC('1000'), btcHolder.address);

      await network.provider.send('hardhat_mine', [
        `0x${Number(30).toString(16)}`,
      ]);

      await network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x0']);

      const market = await mailMarket.marketOf(USDC);

      await expect(
        mailMarket
          .connect(btcHolder)
          .repay(USDC, parseEther('300'), btcHolder.address)
      ).to.emit(mailMarket, 'Accrue');

      const market2 = await mailMarket.marketOf(USDC);

      expect(market2.lastAccruedBlock.gt(market.lastAccruedBlock)).to.be.equal(
        true
      );
    });
    it('reverts if you pass invalid arguments', async () => {
      await Promise.all([
        expect(
          mailMarket.repay(USDC, 0, mailDeployer.address)
        ).to.be.revertedWith('MAIL: principal cannot be 0'),
        expect(
          mailMarket.repay(USDC, 1, ethers.constants.AddressZero)
        ).to.be.revertedWith('MAIL: no to zero address'),
      ]);
    });
    it('allows a user to repay', async () => {
      await Promise.all([
        mailMarket
          .connect(btcHolder)
          .deposit(WBTC, parseWBTC('10'), btcHolder.address),
        mailMarket
          .connect(usdcHolder)
          .deposit(USDC, parseUSDC('100000'), usdcHolder.address),
        usdc
          .connect(usdcHolder)
          .transfer(btcHolder.address, parseUSDC('20000')),
        usdc
          .connect(btcHolder)
          .approve(mailMarket.address, ethers.constants.MaxUint256),
      ]);

      await mailMarket
        .connect(btcHolder)
        .borrow(USDC, parseUSDC('1000'), btcHolder.address);

      await network.provider.send('hardhat_mine', [
        `0x${Number(30).toString(16)}`,
      ]);

      await network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x0']);

      const [usdcAccount, market] = await Promise.all([
        mailMarket.accountOf(USDC, btcHolder.address),
        mailMarket.marketOf(USDC),
      ]);

      expect(usdcAccount.principal).to.be.equal(parseEther('1000'));
      expect(market.loan.base).to.be.equal(parseEther('1000'));
      expect(market.loan.elastic).to.be.equal(parseEther('1000'));

      await expect(
        mailMarket
          .connect(btcHolder)
          .repay(USDC, parseEther('300'), btcHolder.address)
      ).to.emit(mailMarket, 'Repay');

      const [usdcAccount2, market2] = await Promise.all([
        mailMarket.accountOf(USDC, btcHolder.address),
        mailMarket.marketOf(USDC),
      ]);

      expect(usdcAccount2.principal).to.be.equal(parseEther('700'));
      expect(market2.loan.base).to.be.equal(parseEther('700'));
      // interest rate fees
      expect(market2.loan.elastic).to.be.closeTo(
        parseEther('700'),
        parseEther('1')
      );
    });
  });

  it('accepts msg.sender and router as from arguments to request', async () => {
    await Promise.all([
      expect(mailMarket.request(router.address, [], [])).to.be.revertedWith(
        'MAIL: not authorized'
      ),
      expect(mailMarket.request(owner.address, [], [])).to.not.reverted,
      expect(mailMarket.connect(router).request(owner.address, [], [])).to.not
        .reverted,
    ]);
  });

  it('reverts if request receives an invalid action', async () => {
    await expect(
      mailMarket.request(owner.address, [99], [ethers.constants.HashZero])
    );
  });

  describe('function: request deposit', () => {
    it('reverts if the token is not supported', async () => {
      const data = defaultAbiCoder.encode(
        ['address', 'uint256', 'address'],
        [owner.address, 0, owner.address]
      );
      await expect(
        mailMarket.request(owner.address, [ADD_COLLATERAL_REQUEST], [data])
      ).to.be.revertedWith('MAIL: token not listed');
    });

    it('reverts if the arguments are invalid', async () => {
      await Promise.all([
        expect(
          mailMarket
            .connect(btcHolder)
            .request(
              btcHolder.address,
              [ADD_COLLATERAL_REQUEST],
              [
                defaultAbiCoder.encode(
                  ['address', 'uint256', 'address'],
                  [WBTC, 0, owner.address]
                ),
              ]
            )
        ).to.be.revertedWith('MAIL: no zero deposits'),
        expect(
          mailMarket
            .connect(btcHolder)
            .request(
              btcHolder.address,
              [ADD_COLLATERAL_REQUEST],
              [
                defaultAbiCoder.encode(
                  ['address', 'uint256', 'address'],
                  [WBTC, 1, ethers.constants.AddressZero]
                ),
              ]
            )
        ).to.be.revertedWith('MAIL: no zero address deposits'),
      ]);
    });

    it('does not give rewards if there are none', async () => {
      const [wbtcTotalSupply, btcHolderAccount, wbtcMarket] = await Promise.all(
        [
          mailMarket.totalSupplyOf(WBTC),
          mailMarket.accountOf(WBTC, btcHolder.address),
          mailMarket.marketOf(WBTC),
        ]
      );

      await expect(
        mailMarket
          .connect(btcHolder)
          .request(
            btcHolder.address,
            [ADD_COLLATERAL_REQUEST],
            [
              defaultAbiCoder.encode(
                ['address', 'uint256', 'address'],
                [WBTC, parseWBTC('10'), btcHolder.address]
              ),
            ]
          )
      )
        .to.emit(mailMarket, 'Deposit')
        .withArgs(
          btcHolder.address,
          btcHolder.address,
          WBTC,
          parseWBTC('10'),
          0
        );

      const [wbtcTotalSupply2, btcHolderAccount2, wbtcMarket2] =
        await Promise.all([
          mailMarket.totalSupplyOf(WBTC),
          mailMarket.accountOf(WBTC, btcHolder.address),
          mailMarket.marketOf(WBTC),
        ]);

      // Pre-deposit
      expect(wbtcTotalSupply).to.be.equal(0);
      expect(btcHolderAccount.rewardDebt).to.be.equal(0);
      expect(btcHolderAccount.balance).to.be.equal(0);
      expect(btcHolderAccount.principal).to.be.equal(0);
      expect(wbtcMarket.totalReserves).to.be.equal(0);
      expect(wbtcMarket.totalRewardsPerToken).to.be.equal(0);
      expect(wbtcMarket.loan.base).to.be.equal(0);
      expect(wbtcMarket.loan.elastic).to.be.equal(0);

      // Post 10 WBTC deposit
      expect(wbtcTotalSupply2).to.be.equal(parseEther('10'));
      expect(btcHolderAccount2.rewardDebt).to.be.equal(0);
      expect(btcHolderAccount2.balance).to.be.equal(parseEther('10'));
      expect(btcHolderAccount2.principal).to.be.equal(0);
      expect(wbtcMarket2.totalReserves).to.be.equal(0);
      expect(wbtcMarket2.totalRewardsPerToken).to.be.equal(0);
      expect(wbtcMarket2.loan.base).to.be.equal(0);
      expect(wbtcMarket2.loan.elastic).to.be.equal(0);
    });
    it('properly calculates rewards', async () => {
      const btcHolder2 = await impersonate(WBTC_WHALE_2);

      await wbtc
        .connect(btcHolder2)
        .approve(mailMarket.address, ethers.constants.MaxUint256);

      await expect(
        mailMarket
          .connect(btcHolder)
          .request(
            btcHolder.address,
            [ADD_COLLATERAL_REQUEST],
            [
              defaultAbiCoder.encode(
                ['address', 'uint256', 'address'],
                [WBTC, parseWBTC('10'), btcHolder.address]
              ),
            ]
          )
      )
        .to.emit(mailMarket, 'Deposit')
        .withArgs(
          btcHolder.address,
          btcHolder.address,
          WBTC,
          parseWBTC('10'),
          0
        );

      await expect(
        mailMarket
          .connect(btcHolder2)
          .request(
            btcHolder2.address,
            [ADD_COLLATERAL_REQUEST],
            [
              defaultAbiCoder.encode(
                ['address', 'uint256', 'address'],
                [WBTC, parseWBTC('5'), btcHolder2.address]
              ),
            ]
          )
      )
        .to.emit(mailMarket, 'Deposit')
        .withArgs(
          btcHolder2.address,
          btcHolder2.address,
          WBTC,
          parseWBTC('5'),
          0
        );

      await expect(
        mailMarket
          .connect(usdcHolder)
          .request(
            usdcHolder.address,
            [ADD_COLLATERAL_REQUEST],
            [
              defaultAbiCoder.encode(
                ['address', 'uint256', 'address'],
                [USDC, parseUSDC('1000000'), usdcHolder.address]
              ),
            ]
          )
      );

      await mailMarket
        .connect(usdcHolder)
        .borrow(WBTC, parseWBTC('5'), usdcHolder.address);

      await network.provider.send('hardhat_mine', [
        `0x${Number(10).toString(16)}`,
      ]);

      await network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x0']);

      await mailMarket.accrue(WBTC);

      await mailMarket
        .connect(btcHolder)
        .request(
          btcHolder.address,
          [ADD_COLLATERAL_REQUEST],
          [
            defaultAbiCoder.encode(
              ['address', 'uint256', 'address'],
              [WBTC, parseWBTC('1'), btcHolder.address]
            ),
          ]
        );

      const [wbtcTotalSupply, btcHolderAccount, btcHolder2Account, wbtcMarket] =
        await Promise.all([
          mailMarket.totalSupplyOf(WBTC),
          mailMarket.accountOf(WBTC, btcHolder.address),
          mailMarket.accountOf(WBTC, btcHolder2.address),
          mailMarket.marketOf(WBTC),
        ]);

      // 16 deposited plus the supply
      expect(wbtcTotalSupply).to.be.closeTo(
        parseEther('16').add(
          btcHolderAccount.balance
            .sub(parseEther('1'))
            .mul(wbtcMarket.totalRewardsPerToken)
            .div(parseEther('1'))
        ),
        parseEther('0.0000000001')
      );
      expect(btcHolderAccount.principal).to.be.equal(0);
      expect(btcHolderAccount.balance).to.closeTo(
        parseEther('11').add(
          btcHolderAccount.balance
            .sub(parseEther('1'))
            .mul(wbtcMarket.totalRewardsPerToken)
            .div(parseEther('1'))
        ),
        parseEther('0.0000000001')
      );
      expect(btcHolderAccount.rewardDebt).to.be.equal(
        btcHolderAccount.balance
          .mul(wbtcMarket.totalRewardsPerToken)
          .div(parseEther('1'))
      );
      expect(btcHolder2Account.principal).to.be.equal(0);
      expect(btcHolder2Account.balance).to.be.equal(parseEther('5'));
      expect(btcHolder2Account.rewardDebt).to.be.equal(0);

      await mailMarket.accrue(WBTC);

      await mailMarket
        .connect(btcHolder2)
        .request(
          btcHolder2.address,
          [ADD_COLLATERAL_REQUEST],
          [
            defaultAbiCoder.encode(
              ['address', 'uint256', 'address'],
              [WBTC, parseWBTC('1'), btcHolder2.address]
            ),
          ]
        );

      const [
        wbtcTotalSupply2,
        btcHolderAccount2,
        btcHolder2Account2,
        wbtcMarket2,
      ] = await Promise.all([
        mailMarket.totalSupplyOf(WBTC),
        mailMarket.accountOf(WBTC, btcHolder.address),
        mailMarket.accountOf(WBTC, btcHolder2.address),
        mailMarket.marketOf(WBTC),
      ]);

      // 16 deposited plus the supply
      expect(wbtcTotalSupply2).to.be.closeTo(
        wbtcTotalSupply
          .add(
            wbtcMarket2.totalRewardsPerToken
              .mul(btcHolder2Account2.balance.sub(parseEther('1')))
              .div(parseEther('1'))
          )
          .add(parseEther('1')),
        parseEther('0.0000000001')
      );
      expect(btcHolderAccount2.principal).to.be.equal(0);
      expect(btcHolderAccount2.balance).to.equal(btcHolderAccount.balance);
      expect(btcHolderAccount2.rewardDebt).to.be.equal(
        btcHolderAccount.rewardDebt
      );
      expect(btcHolder2Account2.principal).to.be.equal(0);
      expect(btcHolder2Account2.balance).to.be.closeTo(
        btcHolder2Account.balance
          .add(parseEther('1'))
          .add(
            wbtcMarket2.totalRewardsPerToken
              .mul(btcHolder2Account2.balance.sub(parseEther('1')))
              .div(parseEther('1'))
          ),
        parseEther('0.0000000001')
      );
      expect(btcHolder2Account2.rewardDebt).to.be.equal(
        wbtcMarket2.totalRewardsPerToken
          .mul(btcHolder2Account2.balance)
          .div(parseEther('1'))
      );
    });
  });

  describe('function: request withdraw', () => {
    it('reverts if the token is not listed', async () => {
      await expect(
        mailMarket.request(
          owner.address,
          [WITHDRAW_COLLATERAL_REQUEST],
          [
            defaultAbiCoder.encode(
              ['address', 'uint256', 'address'],
              [owner.address, parseWBTC('1'), owner.address]
            ),
          ]
        )
      ).to.be.revertedWith('MAIL: token not listed');
    });
    it('reverts if the arguments are invalid', async () => {
      await Promise.all([
        expect(
          mailMarket
            .connect(btcHolder)
            .request(
              btcHolder.address,
              [WITHDRAW_COLLATERAL_REQUEST],
              [
                defaultAbiCoder.encode(
                  ['address', 'uint256', 'address'],
                  [WBTC, 0, owner.address]
                ),
              ]
            )
        ).to.be.revertedWith('MAIL: no zero withdraws'),
        expect(
          mailMarket
            .connect(btcHolder)
            .request(
              btcHolder.address,
              [WITHDRAW_COLLATERAL_REQUEST],
              [
                defaultAbiCoder.encode(
                  ['address', 'uint256', 'address'],
                  [WBTC, 1, ethers.constants.AddressZero]
                ),
              ]
            )
        ).to.be.revertedWith('MAIL: no zero address'),
      ]);
    });
    it('calls accrue on withdrawals if there is a loan', async () => {
      await Promise.all([
        mailMarket
          .connect(btcHolder)
          .deposit(WBTC, parseWBTC('10'), btcHolder.address),
        mailMarket
          .connect(usdcHolder)
          .deposit(USDC, parseUSDC('100000'), usdcHolder.address),
      ]);

      await advanceBlock(ethers);

      // no borrows so it does not accrue
      await expect(
        mailMarket
          .connect(btcHolder)
          .request(
            btcHolder.address,
            [WITHDRAW_COLLATERAL_REQUEST],
            [
              defaultAbiCoder.encode(
                ['address', 'uint256', 'address'],
                [WBTC, parseWBTC('1'), btcHolder.address]
              ),
            ]
          )
      ).to.not.emit(mailMarket, 'Accrue');

      await mailMarket
        .connect(usdcHolder)
        .borrow(WBTC, parseWBTC('1'), usdcHolder.address);

      await advanceBlock(ethers);

      await expect(
        mailMarket
          .connect(btcHolder)
          .request(
            btcHolder.address,
            [WITHDRAW_COLLATERAL_REQUEST],
            [
              defaultAbiCoder.encode(
                ['address', 'uint256', 'address'],
                [WBTC, parseWBTC('1'), btcHolder.address]
              ),
            ]
          )
      ).to.emit(mailMarket, 'Accrue');
    });
    it('reverts if there is not enough cash', async () => {
      await Promise.all([
        mailMarket
          .connect(btcHolder)
          .deposit(WBTC, parseWBTC('10'), btcHolder.address),
        mailMarket
          .connect(usdcHolder)
          .deposit(USDC, parseUSDC('1000000'), usdcHolder.address),
      ]);

      await mailMarket
        .connect(usdcHolder)
        .borrow(WBTC, parseWBTC('2'), usdcHolder.address);

      await expect(
        mailMarket
          .connect(btcHolder)
          .request(
            btcHolder.address,
            [WITHDRAW_COLLATERAL_REQUEST],
            [
              defaultAbiCoder.encode(
                ['address', 'uint256', 'address'],
                [WBTC, parseWBTC('9'), btcHolder.address]
              ),
            ]
          )
      ).to.be.revertedWith('MAIL: not enough cash');
    });

    it('allows withdraws', async () => {
      const btcHolder2 = await impersonate(WBTC_WHALE_2);

      await wbtc
        .connect(btcHolder2)
        .approve(mailMarket.address, ethers.constants.MaxUint256);

      await Promise.all([
        mailMarket
          .connect(btcHolder)
          .deposit(WBTC, parseWBTC('10'), btcHolder.address),
        mailMarket
          .connect(btcHolder2)
          .deposit(WBTC, parseWBTC('5'), btcHolder2.address),
        mailMarket
          .connect(usdcHolder)
          .deposit(USDC, parseUSDC('2000000'), usdcHolder.address),
      ]);

      await mailMarket
        .connect(usdcHolder)
        .borrow(WBTC, parseWBTC('3'), usdcHolder.address);

      await network.provider.send('hardhat_mine', [
        `0x${Number(10).toString(16)}`,
      ]);

      await network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x0']);

      const [
        wbtcTotalSupply,
        wbtcMarket,
        btcHolderAccount,
        btcHolder2Account,
        btcHolderWBTCBalance,
      ] = await Promise.all([
        mailMarket.totalSupplyOf(WBTC),
        mailMarket.marketOf(WBTC),
        mailMarket.accountOf(WBTC, btcHolder.address),
        mailMarket.accountOf(WBTC, btcHolder2.address),
        wbtc.balanceOf(btcHolder.address),
      ]);

      expect(wbtcTotalSupply).to.be.equal(parseEther('15'));
      expect(wbtcMarket.totalRewardsPerToken).to.be.equal(0);
      expect(wbtcMarket.totalReserves).to.be.equal(0);
      expect(wbtcMarket.loan.base).to.be.equal(parseEther('3'));
      expect(wbtcMarket.loan.elastic).to.be.equal(parseEther('3'));

      expect(btcHolderAccount.rewardDebt).to.be.equal(0);
      expect(btcHolderAccount.balance).to.be.equal(parseEther('10'));
      expect(btcHolderAccount.principal).to.be.equal(0);

      expect(btcHolder2Account.rewardDebt).to.be.equal(0);
      expect(btcHolder2Account.balance).to.be.equal(parseEther('5'));
      expect(btcHolder2Account.principal).to.be.equal(0);

      await expect(
        mailMarket
          .connect(btcHolder)
          .request(
            btcHolder.address,
            [WITHDRAW_COLLATERAL_REQUEST],
            [
              defaultAbiCoder.encode(
                ['address', 'uint256', 'address'],
                [WBTC, parseWBTC('5'), btcHolder.address]
              ),
            ]
          )
      )
        .to.emit(mailMarket, 'Accrue')
        .to.emit(mailMarket, 'Withdraw')
        .to.emit(wbtc, 'Transfer');

      const [
        wbtcTotalSupply2,
        wbtcMarket2,
        btcHolderAccount2,
        btcHolder2Account2,
        btcHolderWBTCBalance2,
        btcHolder2WBTCBalance2,
      ] = await Promise.all([
        mailMarket.totalSupplyOf(WBTC),
        mailMarket.marketOf(WBTC),
        mailMarket.accountOf(WBTC, btcHolder.address),
        mailMarket.accountOf(WBTC, btcHolder2.address),
        wbtc.balanceOf(btcHolder.address),
        wbtc.balanceOf(btcHolder2.address),
      ]);

      expect(wbtcTotalSupply2).to.be.equal(parseEther('10'));

      expect(btcHolderAccount2.rewardDebt).to.be.equal(
        wbtcMarket2.totalRewardsPerToken
          .mul(btcHolderAccount2.balance)
          .div(parseEther('1'))
      );
      // Rewards re sent
      expect(btcHolderWBTCBalance2).to.be.closeTo(
        btcHolderWBTCBalance
          .add(
            wbtcMarket2.totalRewardsPerToken
              .mul(parseEther('15'))
              .div(parseEther('1'))
              .div(parseWBTC('1'))
          )
          .add(parseWBTC('5')),
        10_000
      );

      expect(btcHolderAccount2.balance).to.be.equal(parseEther('5'));
      expect(btcHolderAccount2.principal).to.be.equal(0);
      expect(btcHolder2Account2.rewardDebt).to.be.equal(0);
      expect(btcHolder2Account2.balance).to.be.equal(parseEther('5'));
      expect(btcHolder2Account2.principal).to.be.equal(0);

      mailMarket
        .connect(btcHolder2)
        .request(
          btcHolder2.address,
          [WITHDRAW_COLLATERAL_REQUEST],
          [
            defaultAbiCoder.encode(
              ['address', 'uint256', 'address'],
              [WBTC, parseWBTC('5'), btcHolder2.address]
            ),
          ]
        );

      const [
        wbtcTotalSupply3,
        wbtcMarket3,
        btcHolderAccount3,
        btcHolder2Account3,
        btcHolder2WBTCBalance3,
      ] = await Promise.all([
        mailMarket.totalSupplyOf(WBTC),
        mailMarket.marketOf(WBTC),
        mailMarket.accountOf(WBTC, btcHolder.address),
        mailMarket.accountOf(WBTC, btcHolder2.address),
        wbtc.balanceOf(btcHolder2.address),
      ]);

      expect(wbtcTotalSupply3).to.be.equal(
        wbtcTotalSupply2.sub(parseEther('5'))
      );
      expect(btcHolderAccount3.balance).to.be.equal(btcHolderAccount2.balance);
      expect(btcHolderAccount3.rewardDebt).to.be.equal(
        btcHolderAccount2.rewardDebt
      );
      expect(btcHolderAccount3.principal).to.be.equal(
        btcHolderAccount2.principal
      );

      expect(btcHolder2Account3.balance).to.be.equal(0);
      expect(btcHolder2Account3.rewardDebt).to.be.equal(0);
      expect(btcHolder2Account3.principal).to.be.equal(0);
      expect(btcHolder2WBTCBalance3).to.be.closeTo(
        btcHolder2WBTCBalance2
          .add(parseWBTC('5'))
          .add(
            wbtcMarket3.totalRewardsPerToken
              .mul(parseEther('5'))
              .div(parseEther('1'))
              .div(parseWBTC('1'))
          ),
        10_000
      );
    });
  }).timeout(50_000);

  describe('function: request borrow', () => {
    it('reverts if the token is not listed', async () => {
      await expect(
        mailMarket
          .connect(btcHolder)
          .request(
            btcHolder.address,
            [BORROW_REQUEST],
            [
              defaultAbiCoder.encode(
                ['address', 'uint256', 'address'],
                [recipient.address, 1, recipient.address]
              ),
            ]
          )
      ).to.be.revertedWith('MAIL: token not listed');
    });

    it('does not allow to borrow if you are not solvent', async () => {
      await Promise.all([
        mailMarket
          .connect(btcHolder)
          .deposit(WBTC, parseWBTC('1'), btcHolder.address),
        mailMarket
          .connect(usdcHolder)
          .deposit(USDC, parseUSDC('50000'), btcHolder.address),
        mailMarket
          .connect(wethHolder)
          .deposit(WETH, parseEther('100'), wethHolder.address),
      ]);

      await expect(
        mailMarket
          .connect(btcHolder)
          .request(
            btcHolder.address,
            [BORROW_REQUEST],
            [
              defaultAbiCoder.encode(
                ['address', 'uint256', 'address'],
                [WETH, parseEther('16'), btcHolder.address]
              ),
            ]
          )
      ).to.be.revertedWith('MAIL: from is insolvent');
    });

    it('calls accrue if there is an open loan', async () => {
      await Promise.all([
        mailMarket
          .connect(btcHolder)
          .deposit(WBTC, parseWBTC('1'), btcHolder.address),
        mailMarket
          .connect(usdcHolder)
          .deposit(USDC, parseUSDC('50000'), btcHolder.address),
      ]);

      await expect(
        mailMarket
          .connect(btcHolder)
          .request(
            btcHolder.address,
            [BORROW_REQUEST],
            [
              defaultAbiCoder.encode(
                ['address', 'uint256', 'address'],
                [USDC, parseUSDC('5000'), btcHolder.address]
              ),
            ]
          )
      ).to.not.emit(mailMarket, 'Accrue');

      await expect(
        mailMarket
          .connect(btcHolder)
          .request(
            btcHolder.address,
            [BORROW_REQUEST],
            [
              defaultAbiCoder.encode(
                ['address', 'uint256', 'address'],
                [USDC, parseUSDC('5000'), btcHolder.address]
              ),
            ]
          )
      ).to.emit(mailMarket, 'Accrue');
    });

    it('reverts if the amount is 0 or there is not enough cash', async () => {
      await Promise.all([
        mailMarket
          .connect(btcHolder)
          .deposit(WBTC, parseWBTC('10'), btcHolder.address),
        mailMarket
          .connect(usdcHolder)
          .deposit(USDC, parseUSDC('5000'), btcHolder.address),
      ]);

      await Promise.all([
        expect(
          mailMarket
            .connect(btcHolder)
            .request(
              btcHolder.address,
              [BORROW_REQUEST],
              [
                defaultAbiCoder.encode(
                  ['address', 'uint256', 'address'],
                  [USDC, 0, btcHolder.address]
                ),
              ]
            )
        ).to.be.revertedWith('MAIL: no zero withdraws'),
        expect(
          mailMarket
            .connect(btcHolder)
            .request(
              btcHolder.address,
              [BORROW_REQUEST],
              [
                defaultAbiCoder.encode(
                  ['address', 'uint256', 'address'],
                  [USDC, parseUSDC('5500'), btcHolder.address]
                ),
              ]
            )
        ).to.be.revertedWith('MAIL: not enough cash'),
      ]);
    });

    it('allows borrows', async () => {
      await Promise.all([
        mailMarket
          .connect(btcHolder)
          .deposit(WBTC, parseWBTC('10'), btcHolder.address),
        mailMarket
          .connect(usdcHolder)
          .deposit(USDC, parseUSDC('50000'), usdcHolder.address),
      ]);

      const [btcHolderUSDCAccount, usdcMarket] = await Promise.all([
        mailMarket.accountOf(USDC, btcHolder.address),
        mailMarket.marketOf(USDC),
      ]);

      expect(btcHolderUSDCAccount.principal).to.be.equal(0);
      expect(btcHolderUSDCAccount.balance).to.be.equal(0);
      expect(btcHolderUSDCAccount.rewardDebt).to.be.equal(0);
      expect(usdcMarket.loan.elastic).to.be.equal(0);
      expect(usdcMarket.loan.base).to.be.equal(0);

      await expect(
        mailMarket
          .connect(btcHolder)
          .request(
            btcHolder.address,
            [BORROW_REQUEST],
            [
              defaultAbiCoder.encode(
                ['address', 'uint256', 'address'],
                [USDC, parseUSDC('10000'), btcHolder.address]
              ),
            ]
          )
      )
        .to.emit(mailMarket, 'Borrow')
        .withArgs(
          btcHolder.address,
          btcHolder.address,
          USDC,
          parseUSDC('10000'),
          parseUSDC('10000')
        )
        .to.emit(usdc, 'Transfer')
        .withArgs(mailMarket.address, btcHolder.address, parseUSDC('10000'));

      const [btcHolderUSDCAccount2, usdcMarket2] = await Promise.all([
        mailMarket.accountOf(USDC, btcHolder.address),
        mailMarket.marketOf(USDC),
      ]);

      expect(btcHolderUSDCAccount2.principal).to.be.equal(parseEther('10000'));
      expect(btcHolderUSDCAccount2.balance).to.be.equal(0);
      expect(btcHolderUSDCAccount2.rewardDebt).to.be.equal(0);
      expect(usdcMarket2.loan.elastic).to.be.equal(parseEther('10000'));
      expect(usdcMarket2.loan.base).to.be.equal(parseEther('10000'));

      await mailMarket
        .connect(btcHolder)
        .request(
          btcHolder.address,
          [BORROW_REQUEST],
          [
            defaultAbiCoder.encode(
              ['address', 'uint256', 'address'],
              [USDC, parseUSDC('20000'), btcHolder.address]
            ),
          ]
        );

      const [btcHolderUSDCAccount3, usdcMarket3] = await Promise.all([
        mailMarket.accountOf(USDC, btcHolder.address),
        mailMarket.marketOf(USDC),
      ]);

      expect(btcHolderUSDCAccount3.principal).to.be.equal(
        usdcMarket3.loan.base
      );
      expect(btcHolderUSDCAccount3.balance).to.be.equal(0);
      expect(btcHolderUSDCAccount3.rewardDebt).to.be.equal(0);
      // accrued some interest
      expect(
        usdcMarket3.loan.elastic.gt(
          usdcMarket2.loan.elastic.add(parseEther('20000'))
        )
      ).to.be.equal(true);
      // We calculated the proper fees on the accrue function
      expect(
        usdcMarket3.loan.base.gt(usdcMarket2.loan.base) &&
          usdcMarket3.loan.base.lt(parseEther('30000'))
      ).to.be.equal(true);
    });
  }).timeout(50_000);

  describe('function: request repay', () => {
    it('reverts if the market is not listed', async () => {
      await expect(
        mailMarket.request(
          owner.address,
          [REPAY_REQUEST],
          [
            defaultAbiCoder.encode(
              ['address', 'uint256', 'address'],
              [recipient.address, 0, recipient.address]
            ),
          ]
        )
      ).to.be.revertedWith('MAIL: token not listed');
    });

    it('it accrues', async () => {
      await Promise.all([
        mailMarket
          .connect(btcHolder)
          .deposit(WBTC, parseWBTC('10'), btcHolder.address),
        mailMarket
          .connect(usdcHolder)
          .deposit(USDC, parseUSDC('100000'), usdcHolder.address),
        usdc
          .connect(usdcHolder)
          .transfer(btcHolder.address, parseUSDC('20000')),
        usdc
          .connect(btcHolder)
          .approve(mailMarket.address, ethers.constants.MaxUint256),
      ]);

      await mailMarket
        .connect(btcHolder)
        .borrow(USDC, parseUSDC('1000'), btcHolder.address);

      await network.provider.send('hardhat_mine', [
        `0x${Number(30).toString(16)}`,
      ]);

      await network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x0']);

      const market = await mailMarket.marketOf(USDC);

      await expect(
        mailMarket
          .connect(btcHolder)
          .request(
            btcHolder.address,
            [REPAY_REQUEST],
            [
              defaultAbiCoder.encode(
                ['address', 'uint256', 'address'],
                [USDC, parseEther('300'), btcHolder.address]
              ),
            ]
          )
      ).to.emit(mailMarket, 'Accrue');

      const market2 = await mailMarket.marketOf(USDC);

      expect(market2.lastAccruedBlock.gt(market.lastAccruedBlock)).to.be.equal(
        true
      );
    });
    it('reverts if you pass invalid arguments', async () => {
      await Promise.all([
        expect(
          mailMarket.request(
            owner.address,
            [REPAY_REQUEST],
            [
              defaultAbiCoder.encode(
                ['address', 'uint256', 'address'],
                [USDC, 0, mailDeployer.address]
              ),
            ]
          )
        ).to.be.revertedWith('MAIL: principal cannot be 0'),
        expect(
          mailMarket.request(
            owner.address,
            [REPAY_REQUEST],
            [
              defaultAbiCoder.encode(
                ['address', 'uint256', 'address'],
                [USDC, 1, ethers.constants.AddressZero]
              ),
            ]
          )
        ).to.be.revertedWith('MAIL: no to zero address'),
      ]);
    });
    it('allows a user to repay', async () => {
      await Promise.all([
        mailMarket
          .connect(btcHolder)
          .deposit(WBTC, parseWBTC('10'), btcHolder.address),
        mailMarket
          .connect(usdcHolder)
          .deposit(USDC, parseUSDC('100000'), usdcHolder.address),
        usdc
          .connect(usdcHolder)
          .transfer(btcHolder.address, parseUSDC('20000')),
        usdc
          .connect(btcHolder)
          .approve(mailMarket.address, ethers.constants.MaxUint256),
      ]);

      await mailMarket
        .connect(btcHolder)
        .borrow(USDC, parseUSDC('1000'), btcHolder.address);

      await network.provider.send('hardhat_mine', [
        `0x${Number(30).toString(16)}`,
      ]);

      await network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x0']);

      const [usdcAccount, market] = await Promise.all([
        mailMarket.accountOf(USDC, btcHolder.address),
        mailMarket.marketOf(USDC),
      ]);

      expect(usdcAccount.principal).to.be.equal(parseEther('1000'));
      expect(market.loan.base).to.be.equal(parseEther('1000'));
      expect(market.loan.elastic).to.be.equal(parseEther('1000'));

      await expect(
        mailMarket
          .connect(btcHolder)
          .request(
            btcHolder.address,
            [REPAY_REQUEST],
            [
              defaultAbiCoder.encode(
                ['address', 'uint256', 'address'],
                [USDC, parseEther('300'), btcHolder.address]
              ),
            ]
          )
      ).to.emit(mailMarket, 'Repay');

      const [usdcAccount2, market2] = await Promise.all([
        mailMarket.accountOf(USDC, btcHolder.address),
        mailMarket.marketOf(USDC),
      ]);

      expect(usdcAccount2.principal).to.be.equal(parseEther('700'));
      expect(market2.loan.base).to.be.equal(parseEther('700'));
      // interest rate fees
      expect(market2.loan.elastic).to.be.closeTo(
        parseEther('700'),
        parseEther('1')
      );
    });
  }).timeout(50_000);

  describe('function: liquidate', () => {
    it('reverts if you pass invalida arguments', async () => {
      await Promise.all([
        expect(
          mailMarket.liquidate(
            owner.address,
            owner.address,
            1,
            WBTC,
            owner.address
          )
        ).to.revertedWith('MAIL: borrowToken not listed'),
        expect(
          mailMarket.liquidate(
            owner.address,
            WBTC,
            1,
            owner.address,
            owner.address
          )
        ).to.revertedWith('MAIL: collateralToken not listed'),
        expect(
          mailMarket.liquidate(
            owner.address,
            WBTC,
            1,
            USDC,
            ethers.constants.AddressZero
          )
        ).to.revertedWith('MAIL: no zero address recipient'),
        expect(
          mailMarket.liquidate(owner.address, WBTC, 0, USDC, owner.address)
        ).to.revertedWith('MAIL: no zero principal'),
      ]);
    });

    it('reverts if the user is solvent', async () => {
      await Promise.all([
        mailMarket
          .connect(usdcHolder)
          .deposit(USDC, parseUSDC('100000'), btcHolder.address),
        mailMarket
          .connect(usdcHolder)
          .deposit(USDC, parseUSDC('1000000'), usdcHolder.address),
        mailMarket
          .connect(btcHolder)
          .deposit(WBTC, parseWBTC('10'), btcHolder.address),
      ]);

      await mailMarket
        .connect(btcHolder)
        .borrow(USDC, parseUSDC('170000'), btcHolder.address);

      await expect(
        mailMarket.liquidate(
          btcHolder.address,
          USDC,
          parseUSDC('200000'),
          WBTC,
          owner.address
        )
      ).to.be.revertedWith('MAIL: borrower is solvent');
    });

    it('liquidates a user entire position', async () => {
      const fakeFeed = (await deploy(
        'MockChainLinkFeed',
        []
      )) as MockChainLinkFeed;

      const btcNewPrice = BigNumber.from('12000000000000000000');

      await Promise.all([
        mailMarket
          .connect(usdcHolder)
          .deposit(USDC, parseUSDC('1000000'), usdcHolder.address),
        mailMarket
          .connect(btcHolder)
          .deposit(WBTC, parseWBTC('10'), btcHolder.address),
        fakeFeed.setPrice(btcNewPrice),
      ]);

      await mailMarket
        .connect(btcHolder)
        .borrow(USDC, parseUSDC('170000'), btcHolder.address);

      await oracle.setFeed(WBTC, fakeFeed.address);

      await network.provider.send('hardhat_mine', [
        `0x${Number(10).toString(16)}`,
      ]);

      await network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x0']);

      const [
        btcHolderUSDCAccount,
        usdcMarket,
        wbtcMarket,
        btcHolderWBTCAccount,
        usdcHolderWBTCAccount,
      ] = await Promise.all([
        mailMarket.accountOf(USDC, btcHolder.address),
        mailMarket.marketOf(USDC),
        mailMarket.marketOf(WBTC),
        mailMarket.accountOf(WBTC, btcHolder.address),
        mailMarket.accountOf(WBTC, usdcHolder.address),
      ]);

      expect(btcHolderUSDCAccount.principal).to.be.equal(parseEther('170000'));
      expect(usdcMarket.loan.base).to.be.equal(parseEther('170000'));
      expect(usdcMarket.loan.elastic).to.be.equal(parseEther('170000'));
      expect(wbtcMarket.totalReserves).to.be.equal(0);
      expect(btcHolderWBTCAccount.balance).to.be.equal(parseEther('10'));
      expect(usdcHolderWBTCAccount.balance).to.be.equal(0);

      await expect(
        mailMarket
          .connect(usdcHolder)
          .liquidate(
            btcHolder.address,
            USDC,
            parseUSDC('200001'),
            WBTC,
            usdcHolder.address
          )
      ).emit(mailMarket, 'Liquidate');

      const [
        btcHolderUSDCAccount2,
        usdcMarket2,
        wbtcMarket2,
        btcHolderWBTCAccount2,
        usdcHolderWBTCAccount2,
        debtInETH,
      ] = await Promise.all([
        mailMarket.accountOf(USDC, btcHolder.address),
        mailMarket.marketOf(USDC),
        mailMarket.marketOf(WBTC),
        mailMarket.accountOf(WBTC, btcHolder.address),
        mailMarket.accountOf(WBTC, usdcHolder.address),
        oracle.getETHPrice(
          USDC,
          parseEther('170000').add(
            parseEther('170000').mul(parseEther('0.15')).div(parseEther('1'))
          )
        ),
      ]);

      const collateralToCover = debtInETH.mul(parseEther('1')).div(btcNewPrice);
      const liquidatorPortion = collateralToCover
        .mul(parseEther('0.98'))
        .div(parseEther('1'));

      expect(btcHolderUSDCAccount2.principal).to.be.equal(0);
      expect(usdcMarket2.loan.base).to.be.equal(0);
      expect(usdcMarket2.loan.elastic).to.be.equal(0);

      expect(wbtcMarket2.totalReserves).to.be.closeTo(
        collateralToCover.sub(liquidatorPortion),
        parseEther('1')
      );
      expect(btcHolderWBTCAccount2.balance).to.be.closeTo(
        parseEther('10').sub(collateralToCover),
        parseEther('1')
      );
      expect(usdcHolderWBTCAccount2.balance).to.be.closeTo(
        liquidatorPortion,
        parseEther('1')
      );
    });

    it('liquidates a portion of a user position', async () => {
      const fakeFeed = (await deploy(
        'MockChainLinkFeed',
        []
      )) as MockChainLinkFeed;

      const btcNewPrice = BigNumber.from('12000000000000000000');

      await Promise.all([
        mailMarket
          .connect(usdcHolder)
          .deposit(USDC, parseUSDC('1000000'), usdcHolder.address),
        mailMarket
          .connect(btcHolder)
          .deposit(WBTC, parseWBTC('10'), btcHolder.address),
        fakeFeed.setPrice(btcNewPrice),
      ]);

      await mailMarket
        .connect(btcHolder)
        .borrow(USDC, parseUSDC('170000'), btcHolder.address);

      await oracle.setFeed(WBTC, fakeFeed.address);

      await network.provider.send('hardhat_mine', [
        `0x${Number(10).toString(16)}`,
      ]);

      await network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x0']);

      const [
        btcHolderUSDCAccount,
        usdcMarket,
        wbtcMarket,
        btcHolderWBTCAccount,
        usdcHolderWBTCAccount,
      ] = await Promise.all([
        mailMarket.accountOf(USDC, btcHolder.address),
        mailMarket.marketOf(USDC),
        mailMarket.marketOf(WBTC),
        mailMarket.accountOf(WBTC, btcHolder.address),
        mailMarket.accountOf(WBTC, usdcHolder.address),
      ]);

      expect(btcHolderUSDCAccount.principal).to.be.equal(parseEther('170000'));
      expect(usdcMarket.loan.base).to.be.equal(parseEther('170000'));
      expect(usdcMarket.loan.elastic).to.be.equal(parseEther('170000'));
      expect(wbtcMarket.totalReserves).to.be.equal(0);
      expect(btcHolderWBTCAccount.balance).to.be.equal(parseEther('10'));
      expect(usdcHolderWBTCAccount.balance).to.be.equal(0);

      await expect(
        mailMarket
          .connect(usdcHolder)
          .liquidate(
            btcHolder.address,
            USDC,
            parseUSDC('50000'),
            WBTC,
            usdcHolder.address
          )
      ).emit(mailMarket, 'Liquidate');

      const [
        btcHolderUSDCAccount2,
        usdcMarket2,
        wbtcMarket2,
        btcHolderWBTCAccount2,
        usdcHolderWBTCAccount2,
        debtInETH,
      ] = await Promise.all([
        mailMarket.accountOf(USDC, btcHolder.address),
        mailMarket.marketOf(USDC),
        mailMarket.marketOf(WBTC),
        mailMarket.accountOf(WBTC, btcHolder.address),
        mailMarket.accountOf(WBTC, usdcHolder.address),
        oracle.getETHPrice(
          USDC,
          parseEther('50000').add(
            parseEther('50000').mul(parseEther('0.15')).div(parseEther('1'))
          )
        ),
      ]);

      const collateralToCover = debtInETH.mul(parseEther('1')).div(btcNewPrice);
      const liquidatorPortion = collateralToCover
        .mul(parseEther('0.98'))
        .div(parseEther('1'));

      expect(btcHolderUSDCAccount2.principal).to.be.equal(parseEther('120000'));
      expect(usdcMarket2.loan.base).to.be.equal(parseEther('120000'));
      expect(usdcMarket2.loan.elastic.gte(parseEther('120000'))).to.be.equal(
        true
      );

      expect(wbtcMarket2.totalReserves).to.be.closeTo(
        collateralToCover.sub(liquidatorPortion),
        parseEther('1')
      );
      expect(btcHolderWBTCAccount2.balance).to.be.closeTo(
        parseEther('10').sub(collateralToCover),
        parseEther('1')
      );
      expect(usdcHolderWBTCAccount2.balance).to.be.closeTo(
        liquidatorPortion,
        parseEther('1')
      );
    });
  });
}).timeout(50_000);
