//SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.13;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IMAILDeployer.sol";
import "./interfaces/IOracle.sol";
import "./interfaces/InterestRateModelInterface.sol";

import "./lib/Rebase.sol";
import "./lib/IntMath.sol";
import "./lib/IntERC20.sol";

contract MAIL {
    /*///////////////////////////////////////////////////////////////
                                EVENT
    //////////////////////////////////////////////////////////////*/

    event Accrue(
        address indexed token,
        uint256 cash,
        uint256 interestAccumulated,
        uint256 totalShares,
        uint256 totalBorrow
    );

    event Deposit(address token, uint256 amount, uint256 rewards);

    event GetEarnings(
        address indexed token,
        address indexed treasury,
        uint256 indexed amount
    );

    event Borrow(
        address indexed token,
        address indexed borrower,
        uint256 principal,
        uint256 amount
    );

    event Repay(
        address indexed token,
        address indexed account,
        uint256 principal,
        uint256 amount
    );

    /*///////////////////////////////////////////////////////////////
                                LIBRARIES
    //////////////////////////////////////////////////////////////*/

    using SafeCast for uint256;
    using RebaseLibrary for Rebase;
    using IntMath for uint256;
    using SafeERC20 for IERC20;
    using IntERC20 for address;

    /*///////////////////////////////////////////////////////////////
                                STATE
    //////////////////////////////////////////////////////////////*/

    struct Market {
        uint128 lastAccruedBlock;
        uint128 totalReserves;
        uint256 totalRewardsPerToken;
        Rebase loan;
    }

    struct Account {
        uint256 rewardDebt;
        uint128 balance;
        uint128 principal;
    }

    /*///////////////////////////////////////////////////////////////
                                STATE
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Maximum borrow rate that can ever be applied (.0005% / block)
     * @notice Taken directly from Compound https://github.com/compound-finance/compound-protocol/blob/master/contracts/CTokenInterfaces.sol
     */

    uint256 private constant BORROW_RATE_MAX_MANTISSA = 0.0005e16;

    //solhint-disable-next-line var-name-mixedcase
    address private immutable MAIL_DEPLOYER;

    //solhint-disable-next-line var-name-mixedcase
    address private immutable RISKY_TOKEN;

    //solhint-disable-next-line var-name-mixedcase
    address private immutable ORACLE;

    //solhint-disable-next-line var-name-mixedcase
    address[] private TOKENS;

    // Token => Account => Collateral Balance
    mapping(address => mapping(address => uint256)) public balanceOf;

    // Token => Account => Borrow Balance
    mapping(address => mapping(address => uint256)) public borrowOf;

    // Token => Market
    mapping(address => Market) public marketOf;

    // Token => Bool
    mapping(address => bool) public isMarket;

    // Token => Account => Account
    mapping(address => mapping(address => Account)) public accountOf;

    // Token => Total Supply
    mapping(address => uint256) public totalSupplyOf;

    /*///////////////////////////////////////////////////////////////
                            CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor() {
        IMAILDeployer mailDeployer = IMAILDeployer(msg.sender);

        address btc = mailDeployer.BTC();
        address usdt = mailDeployer.USDT();
        address usdc = mailDeployer.USDC();
        address wrappedNativeToken = mailDeployer.BRIDGE_TOKEN();
        address riskyToken = mailDeployer.riskyToken();

        RISKY_TOKEN = riskyToken;
        ORACLE = mailDeployer.ORACLE();
        MAIL_DEPLOYER = msg.sender;

        isMarket[usdt] = true;
        isMarket[btc] = true;
        isMarket[usdc] = true;
        isMarket[wrappedNativeToken] = true;
        isMarket[riskyToken] = true;

        TOKENS.push(btc);
        TOKENS.push(usdt);
        TOKENS.push(usdc);
        TOKENS.push(wrappedNativeToken);
        TOKENS.push(riskyToken);
    }

    /*///////////////////////////////////////////////////////////////
                            MODIFIER
    //////////////////////////////////////////////////////////////*/

    modifier isTokenListed(address token) {
        require(isMarket[token], "MAIL: token not listed");
        _;
    }

    modifier isSolvent() {
        _;
        require(_isSolvent(msg.sender), "MAIL: account is insolvent");
    }

    /*///////////////////////////////////////////////////////////////
                            VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Returns the current balance of `token` this contract has.
     *
     * @notice It includes reserves
     *
     * @param token The address of the token that we will check the current balance
     * @return uint256 The current balance
     */
    function getCash(address token) public view returns (uint256) {
        return _getBaseAmount(token, IERC20(token).balanceOf(address(this)));
    }

    /*///////////////////////////////////////////////////////////////
                            MUTATIVE FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function getEarnings(address token, uint256 amount)
        external
        isTokenListed(token)
    {
        IMAILDeployer mailDeployer = IMAILDeployer(MAIL_DEPLOYER);

        require(msg.sender == mailDeployer.owner(), "MAIL: not authorized");

        uint256 cash = getCash(token);

        Market memory market = marketOf[token];

        uint256 baseAmount = _getBaseAmount(token, amount);

        require(cash >= baseAmount, "MAIL: not enough cash");
        require(
            market.totalReserves >= baseAmount,
            "MAIL: not enough reserves"
        );

        market.totalReserves -= baseAmount.toUint128();

        address treasury = mailDeployer.treasury();

        IERC20(token).safeTransfer(treasury, amount);

        emit GetEarnings(token, treasury, amount);
    }

    function accrue(address token) external isTokenListed(token) {
        _accrue(token);
    }

    function deposit(address token, uint256 amount)
        external
        isTokenListed(token)
    {
        require(amount > 0, "MAIL: no zero deposits");
        // Accumulate interest
        _accrue(token);

        uint256 totalSupply = totalSupplyOf[token];
        Account memory account = accountOf[token][msg.sender];
        uint256 rewards;

        uint256 _totalRewards = marketOf[token].totalRewardsPerToken;

        // Pay
        if (account.balance > 0) {
            rewards =
                uint256(account.balance).bmul(_totalRewards) -
                account.rewardDebt;
        }

        // Get tokens from user
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // All values in this contract use decimals 18
        uint256 baseAmount = _getBaseAmount(token, amount);

        uint256 newAmount = baseAmount + rewards;

        // Update Local State
        account.balance += newAmount.toUint128();
        account.rewardDebt = uint256(account.balance).bmul(_totalRewards);
        totalSupply += newAmount;

        // Update Global state
        totalSupplyOf[token] = totalSupply;
        accountOf[token][msg.sender] = account;

        emit Deposit(token, amount, rewards);
    }

    function withdraw(address token, uint256 amount)
        external
        isTokenListed(token)
        isSolvent
    {
        require(amount > 0, "MAIL: no zero withdraws");

        // Accumulate interest
        _accrue(token);

        uint256 totalSupply = totalSupplyOf[token];
        Account memory account = accountOf[token][msg.sender];

        uint256 _totalRewards = marketOf[token].totalRewardsPerToken;

        uint256 rewards = uint256(account.balance).bmul(_totalRewards) -
            account.rewardDebt;

        // All values in this contract use decimals 18
        uint256 baseAmount = _getBaseAmount(token, amount);

        account.balance -= baseAmount.toUint128();
        account.rewardDebt = uint256(account.balance).bmul(_totalRewards);
        totalSupply -= baseAmount;

        // Update Global state
        totalSupplyOf[token] = totalSupply;
        accountOf[token][msg.sender] = account;

        IERC20(token).safeTransfer(
            msg.sender,
            amount + rewards.fromBase(token.safeDecimals())
        );
    }

    function borrow(address token, uint256 amount)
        external
        isTokenListed(token)
        isSolvent
    {
        _accrue(token);

        uint256 baseAmount = _getBaseAmount(token, amount);
        require(getCash(token) >= baseAmount, "MAIL: not enough cash");

        uint256 totalSupply = totalSupplyOf[token];

        Account memory account = accountOf[token][msg.sender];
        Market memory market = marketOf[token];
        Rebase memory loan = market.loan;

        uint256 _totalRewards = market.totalRewardsPerToken;

        uint256 rewards = uint256(account.balance).bmul(_totalRewards) -
            account.rewardDebt;

        (Rebase memory _loan, uint256 principal) = loan.add(baseAmount, true);

        account.principal += principal.toUint128();
        account.balance += rewards.toUint128();
        account.rewardDebt = uint256(account.balance).bmul(_totalRewards);
        totalSupply += totalSupply;
        market.loan = _loan;

        totalSupplyOf[token] = totalSupply;
        accountOf[token][msg.sender] = account;
        marketOf[token] = market;

        IERC20(token).safeTransfer(msg.sender, amount);

        emit Borrow(token, msg.sender, principal, amount);
    }

    function repay(address token, uint256 principal)
        external
        isTokenListed(token)
    {
        require(principal > 0, "MAIL: principal cannot be 0");

        _accrue(token);

        Market memory market = marketOf[token];
        Rebase memory loan = market.loan;
        Account memory account = accountOf[token][msg.sender];

        (Rebase memory _loan, uint256 debt) = loan.sub(principal, true);

        IERC20(token).safeTransferFrom(
            msg.sender,
            address(this),
            debt.fromBase(token.safeDecimals())
        );

        market.loan = _loan;
        account.principal -= principal.toUint128();

        marketOf[token] = market;

        emit Repay(token, msg.sender, principal, debt);
    }

    /*///////////////////////////////////////////////////////////////
                            PRIVATE FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function _isSolvent(address caller) private view returns (bool) {
        address[] memory tokens = TOKENS;
        address mailDeployer = MAIL_DEPLOYER;
        address riskyToken = RISKY_TOKEN;

        IOracle oracle = IOracle(ORACLE);

        uint256 totalDebtInUSD;
        uint256 totalCollateralInUSD;

        for (uint256 i; i < tokens.length; i++) {
            address token = tokens[i];
            Account memory account = accountOf[token][caller];

            if (account.balance == 0 && account.principal == 0) continue;

            (Market memory market, ) = _viewAccrue(
                mailDeployer,
                token,
                getCash(token)
            );

            Rebase memory loan = market.loan;

            uint256 amountOwed = loan.toElastic(account.principal, true);

            if (token == riskyToken) {
                totalDebtInUSD += oracle.getRiskytokenPrice(
                    riskyToken,
                    amountOwed
                );

                uint256 tvlRatio = IMAILDeployer(mailDeployer).riskyTokenLTV();
                totalCollateralInUSD += oracle
                    .getUSDPrice(token, account.balance)
                    .bmul(tvlRatio);
            } else {
                totalDebtInUSD += oracle.getUSDPrice(token, amountOwed);
                uint256 tvlRatio = IMAILDeployer(mailDeployer).maxLTVOf(token);
                totalCollateralInUSD += oracle
                    .getUSDPrice(token, account.balance)
                    .bmul(tvlRatio);
            }
        }

        return
            totalDebtInUSD == 0 ? true : totalCollateralInUSD > totalDebtInUSD;
    }

    function _getBaseAmount(address token, uint256 amount)
        private
        view
        returns (uint256)
    {
        return amount.toBase(token.safeDecimals());
    }

    function _accrue(address token) private {
        uint256 currentBlock = block.number;

        Market memory market = marketOf[token];
        Rebase memory loan = market.loan;

        uint256 lastAccruedBlock = market.lastAccruedBlock;

        if (currentBlock == lastAccruedBlock) return;

        market.lastAccruedBlock = block.number.toUint128();

        if (loan.base == 0) {
            marketOf[token] = market;
            return;
        }
        uint256 cash = getCash(token);

        uint256 interestAccumulated;

        (marketOf[token], interestAccumulated) = _viewAccrue(
            MAIL_DEPLOYER,
            token,
            cash
        );

        emit Accrue(token, cash, interestAccumulated, loan.base, loan.elastic);
    }

    function _viewAccrue(
        address _mailDeployer,
        address token,
        uint256 cash
    ) private view returns (Market memory, uint256) {
        Market memory market = marketOf[token];
        Rebase memory loan = market.loan;

        IMAILDeployer mailDeployer = IMAILDeployer(_mailDeployer);

        uint256 lastAccruedBlock = market.lastAccruedBlock;

        market.lastAccruedBlock = block.number.toUint128();

        InterestRateModelInterface interestRateModel = InterestRateModelInterface(
                mailDeployer.getInterestRateModel(token)
            );

        uint256 borrowRatePerBlock = interestRateModel.getBorrowRatePerBlock(
            cash,
            loan.elastic,
            market.totalReserves
        );

        require(
            BORROW_RATE_MAX_MANTISSA > borrowRatePerBlock,
            "MAIL: borrow rate too high"
        );

        uint256 blocksElapsed;

        unchecked {
            blocksElapsed = block.number - lastAccruedBlock;
        }

        // Uniswap block scope style
        {
            uint256 interestAccumulated = blocksElapsed * borrowRatePerBlock;

            (loan, ) = loan.add(interestAccumulated.bmul(loan.elastic), true);

            uint256 reserveRewards = interestAccumulated.bmul(
                mailDeployer.reserveFactor()
            );

            uint256 totalSupply = totalSupplyOf[token];

            // If we have open loans, the total supply must be greater than 0
            assert(totalSupply > 0);

            market.totalReserves += (reserveRewards).toUint128();

            market.loan = loan;
            market.totalRewardsPerToken += (interestAccumulated -
                reserveRewards).bdiv(totalSupply);

            return (market, interestAccumulated);
        }
    }
}
