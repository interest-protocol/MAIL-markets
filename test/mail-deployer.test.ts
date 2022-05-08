import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';

import { MAILDeployer } from '../typechain';
import { SHIBA_INU, USDC, USDT, WBTC, WETH } from './utils/constants';
import { deploy } from './utils/test-utils';

const { parseEther, defaultAbiCoder } = ethers.utils;

const INITIAL_LTV = parseEther('0.5');

describe('MAILDeployer', () => {
  let mailDeployer: MAILDeployer;

  let owner: SignerWithAddress;
  let oracle: SignerWithAddress;
  let router: SignerWithAddress;
  let treasury: SignerWithAddress;

  let btcModel: SignerWithAddress;
  let usdcModel: SignerWithAddress;
  let usdtModel: SignerWithAddress;
  let ethModel: SignerWithAddress;
  let riskyToken: SignerWithAddress;

  const reserveFactor = parseEther('0.15');

  beforeEach(async () => {
    [
      owner,
      oracle,
      router,
      treasury,
      btcModel,
      usdcModel,
      usdcModel,
      usdtModel,
      ethModel,
      riskyToken,
    ] = await ethers.getSigners();

    const data = defaultAbiCoder.encode(
      ['address', 'address', 'address', 'address', 'address'],
      [
        btcModel.address,
        usdcModel.address,
        ethModel.address,
        usdtModel.address,
        riskyToken.address,
      ]
    );

    mailDeployer = await deploy('MAILDeployer', [
      oracle.address,
      router.address,
      treasury.address,
      reserveFactor,
      data,
    ]);
  });

  describe('constructor', () => {
    it('sets a max tvl for all tokens', async () => {
      const [wbtcLTV, wethLTV, usdcLTV, usdtLTV, riskyTokenLTV] =
        await Promise.all([
          mailDeployer.maxLTVOf(WBTC),
          mailDeployer.maxLTVOf(WETH),
          mailDeployer.maxLTVOf(USDC),
          mailDeployer.maxLTVOf(USDT),
          mailDeployer.riskyTokenLTV(),
        ]);

      expect(wbtcLTV).to.be.equal(INITIAL_LTV);
      expect(wethLTV).to.be.equal(INITIAL_LTV);
      expect(usdcLTV).to.be.equal(INITIAL_LTV);
      expect(usdtLTV).to.be.equal(INITIAL_LTV);
      expect(wbtcLTV).to.be.equal(INITIAL_LTV);
      expect(riskyTokenLTV).to.be.equal(INITIAL_LTV);
    });

    it('reverts if one of the models is not set', async () => {
      expect(
        deploy('MAILDeployer', [
          oracle.address,
          router.address,
          treasury.address,
          reserveFactor,
          defaultAbiCoder.encode(
            ['address', 'address', 'address', 'address', 'address'],
            [
              ethers.constants.AddressZero,
              usdcModel.address,
              ethModel.address,
              usdtModel.address,
              riskyToken.address,
            ]
          ),
        ])
      ).to.revertedWith('btc: no zero address');
      expect(
        deploy('MAILDeployer', [
          oracle.address,
          router.address,
          treasury.address,
          reserveFactor,
          defaultAbiCoder.encode(
            ['address', 'address', 'address', 'address', 'address'],
            [
              btcModel.address,
              ethers.constants.AddressZero,
              ethModel.address,
              usdtModel.address,
              riskyToken.address,
            ]
          ),
        ])
      ).to.revertedWith('usdc: no zero address');
      expect(
        deploy('MAILDeployer', [
          oracle.address,
          router.address,
          treasury.address,
          reserveFactor,
          defaultAbiCoder.encode(
            ['address', 'address', 'address', 'address', 'address'],
            [
              btcModel.address,
              usdcModel.address,
              ethers.constants.AddressZero,
              usdtModel.address,
              riskyToken.address,
            ]
          ),
        ])
      ).to.revertedWith('eth: no zero address');
      expect(
        deploy('MAILDeployer', [
          oracle.address,
          router.address,
          treasury.address,
          reserveFactor,
          defaultAbiCoder.encode(
            ['address', 'address', 'address', 'address', 'address'],
            [
              btcModel.address,
              usdcModel.address,
              ethModel.address,
              ethers.constants.AddressZero,
              riskyToken.address,
            ]
          ),
        ])
      ).to.revertedWith('usdt: no zero address');
      expect(
        deploy('MAILDeployer', [
          oracle.address,
          router.address,
          treasury.address,
          reserveFactor,
          defaultAbiCoder.encode(
            ['address', 'address', 'address', 'address', 'address'],
            [
              btcModel.address,
              usdcModel.address,
              ethModel.address,
              usdtModel.address,
              ethers.constants.AddressZero,
            ]
          ),
        ])
      ).to.revertedWith('usdt: no zero address');
    });

    it('sets the models correctly', async () => {
      const [_btcModel, _wethModel, _usdcModel, _usdtModel, _riskyModel] =
        await Promise.all([
          mailDeployer.getInterestRateModel(WBTC),
          mailDeployer.getInterestRateModel(WETH),
          mailDeployer.getInterestRateModel(USDC),
          mailDeployer.getInterestRateModel(USDT),
          mailDeployer.riskyTokenInterestRateModel(),
        ]);

      expect(_btcModel).to.be.equal(btcModel.address);
      expect(_wethModel).to.be.equal(ethModel.address);
      expect(_usdcModel).to.be.equal(usdcModel.address);
      expect(_usdtModel).to.be.equal(usdtModel.address);
      expect(_riskyModel).to.be.equal(riskyToken.address);
    });
  });

  it('returns the number of uniswap fees registered', async () => {
    expect(await mailDeployer.getFeesLength()).to.be.equal(3);
  });

  describe('function: deploy', () => {
    it('reverts if you pass the wrong arguments', async () => {
      await expect(mailDeployer.deploy(WBTC)).to.be.revertedWith(
        'MD: cannot be BTC'
      );
      await expect(mailDeployer.deploy(WETH)).to.be.revertedWith(
        'MD: cannot be WETH'
      );
      await expect(mailDeployer.deploy(USDC)).to.be.revertedWith(
        'MD: cannot be USDC'
      );
      await expect(mailDeployer.deploy(USDT)).to.be.revertedWith(
        'MD: cannot be USDT'
      );
      await expect(
        mailDeployer.deploy(ethers.constants.AddressZero)
      ).to.be.revertedWith('MD: no zero address');

      await expect(
        mailDeployer.deploy(owner.address) // it is not a token so it has no pool
      ).to.be.revertedWith('MD: no pool for this token');
    });
    it('deploys a MAIL Market', async () => {
      const predictedAddress = await mailDeployer.predictMarketAddress(
        SHIBA_INU
      );
      expect(await mailDeployer.riskyToken()).to.be.equal(
        ethers.constants.AddressZero
      );
      await expect(mailDeployer.deploy(SHIBA_INU))
        .to.emit(mailDeployer, 'MarketCreated')
        .withArgs(predictedAddress);

      expect(await mailDeployer.getMarket(SHIBA_INU)).to.be.equal(
        predictedAddress
      );

      await expect(mailDeployer.deploy(SHIBA_INU)).to.revertedWith(
        'MD: market already deployed'
      );
      expect(await mailDeployer.riskyToken()).to.be.equal(
        ethers.constants.AddressZero
      );
    });
  });
  describe('owner functions', () => {
    it('reverts if not called by the owner', async () => {
      await Promise.all([
        expect(mailDeployer.connect(oracle).addUniswapV3Fee(2)).to.revertedWith(
          'Ownable: caller is not the owner'
        ),
        expect(
          mailDeployer.connect(oracle).setReserveFactor(2)
        ).to.revertedWith('Ownable: caller is not the owner'),
        expect(
          mailDeployer.connect(oracle).setTreasury(oracle.address)
        ).to.revertedWith('Ownable: caller is not the owner'),
        expect(
          mailDeployer
            .connect(oracle)
            .setInterestRateModel(oracle.address, oracle.address)
        ).to.revertedWith('Ownable: caller is not the owner'),
        expect(
          mailDeployer
            .connect(oracle)
            .setRiskyTokenInterestRateModel(oracle.address)
        ).to.revertedWith('Ownable: caller is not the owner'),
        expect(
          mailDeployer.connect(oracle).setTokenLTV(oracle.address, 100)
        ).to.revertedWith('Ownable: caller is not the owner'),
        expect(
          mailDeployer.connect(oracle).setRiskyTokenLTV(100)
        ).to.revertedWith('Ownable: caller is not the owner'),
        expect(
          mailDeployer.connect(oracle).setLiquidationFee(1)
        ).to.revertedWith('Ownable: caller is not the owner'),
        expect(
          mailDeployer.connect(oracle).setLiquidatorPortion(1)
        ).to.revertedWith('Ownable: caller is not the owner'),
      ]);
    });
    it('adds a new fee', async () => {
      expect(await mailDeployer.getFeesLength()).to.be.equal(3);

      await expect(
        mailDeployer.connect(owner).addUniswapV3Fee(500)
      ).to.be.revertedWith('MD: uni fee already added');

      await expect(mailDeployer.connect(owner).addUniswapV3Fee(2000))
        .to.emit(mailDeployer, 'NewUniSwapFee')
        .withArgs(2000);

      expect(await mailDeployer.getFee(3)).to.be.equal(2000);
    });
    it('updates the reserve factor', async () => {
      expect(await mailDeployer.reserveFactor()).to.be.equal(reserveFactor);
      await expect(
        mailDeployer.connect(owner).setReserveFactor(parseEther('0.251'))
      ).to.be.revertedWith('MD: too  high');

      await expect(
        mailDeployer.connect(owner).setReserveFactor(parseEther('0.2'))
      )
        .to.emit(mailDeployer, 'SetReserveFactor')
        .withArgs(parseEther('0.2'));

      expect(await mailDeployer.reserveFactor()).to.be.equal(parseEther('0.2'));
    });
    it('updates the treasury address', async () => {
      expect(await mailDeployer.connect(owner).treasury()).to.be.equal(
        treasury.address
      );
      await expect(mailDeployer.connect(owner).setTreasury(owner.address))
        .to.emit(mailDeployer, 'SetTreasury')
        .withArgs(owner.address);

      expect(await mailDeployer.connect(owner).treasury()).to.be.equal(
        owner.address
      );
    });
    it('sets a new interest rate model', async () => {
      await Promise.all([
        expect(
          mailDeployer
            .connect(owner)
            .setInterestRateModel(ethers.constants.AddressZero, owner.address)
        ).to.be.revertedWith('MD: no zero address'),
        expect(
          mailDeployer
            .connect(owner)
            .setInterestRateModel(ethers.constants.AddressZero, owner.address)
        ).to.be.revertedWith('MD: no zero address'),
      ]);

      expect(await mailDeployer.getInterestRateModel(WBTC)).to.be.equal(
        btcModel.address
      );

      await expect(
        mailDeployer.connect(owner).setInterestRateModel(WBTC, ethModel.address)
      )
        .to.emit(mailDeployer, 'SetInterestRateModel')
        .withArgs(WBTC, ethModel.address);

      expect(await mailDeployer.getInterestRateModel(WBTC)).to.be.equal(
        ethModel.address
      );
    });
    it('sets interest rate model for the risky token', async () => {
      await expect(
        mailDeployer.setRiskyTokenInterestRateModel(
          ethers.constants.AddressZero
        )
      ).to.be.revertedWith('MD: no zero address');
      expect(await mailDeployer.riskyTokenInterestRateModel()).to.be.equal(
        riskyToken.address
      );
      await expect(
        mailDeployer
          .connect(owner)
          .setRiskyTokenInterestRateModel(owner.address)
      )
        .to.emit(mailDeployer, 'SetInterestRateModel')
        .withArgs(ethers.constants.AddressZero, owner.address);
      expect(await mailDeployer.riskyTokenInterestRateModel()).to.be.equal(
        owner.address
      );
    });
    it('sets a new LTV for a token', async () => {
      expect(await mailDeployer.maxLTVOf(WBTC)).to.be.equal(INITIAL_LTV);
      await expect(
        mailDeployer.connect(owner).setTokenLTV(WBTC, parseEther('0.91'))
      ).to.revertedWith('MD: LTV too high');
      await expect(
        mailDeployer.connect(owner).setTokenLTV(WBTC, parseEther('0.7'))
      )
        .to.emit(mailDeployer, 'SetNewTokenLTV')
        .withArgs(WBTC, parseEther('0.7'));
    });
    it('sets new LTV for the risky asset', async () => {
      expect(await mailDeployer.riskyTokenLTV()).to.be.equal(INITIAL_LTV);

      await expect(
        mailDeployer.connect(owner).setRiskyTokenLTV(parseEther('0.71'))
      ).to.be.revertedWith('MD: LTV too high');

      await expect(
        mailDeployer.connect(owner).setRiskyTokenLTV(parseEther('0.65'))
      )
        .to.emit(mailDeployer, 'SetNewTokenLTV')
        .withArgs(ethers.constants.AddressZero, parseEther('0.65'));
    });
    it('sets liquidation fee', async () => {
      expect(await mailDeployer.liquidationFee()).to.be.equal(
        parseEther('0.15')
      );
      await Promise.all([
        expect(
          mailDeployer.connect(owner).setLiquidationFee(0)
        ).to.be.revertedWith('MD: fee out of bounds'),
        expect(
          mailDeployer.connect(owner).setLiquidationFee(parseEther('0.31'))
        ).to.be.revertedWith('MD: fee out of bounds'),
      ]);

      await expect(
        mailDeployer.connect(owner).setLiquidationFee(parseEther('0.2'))
      )
        .to.emit(mailDeployer, 'SetLiquidationFee')
        .withArgs(parseEther('0.2'));

      expect(await mailDeployer.liquidationFee()).to.be.equal(
        parseEther('0.2')
      );
    });
    it('sets a new liquidator portion', async () => {
      expect(await mailDeployer.liquidatorPortion()).to.be.equal(
        parseEther('0.98')
      );
      await expect(
        mailDeployer.connect(owner).setLiquidatorPortion(parseEther('0.949'))
      ).to.be.revertedWith('MD: too low');

      await expect(
        mailDeployer.connect(owner).setLiquidatorPortion(parseEther('0.99'))
      )
        .to.emit(mailDeployer, 'SetLiquidatorPortion')
        .withArgs(parseEther('0.99'));

      expect(await mailDeployer.liquidatorPortion()).to.be.equal(
        parseEther('0.99')
      );
    });
  });
});
