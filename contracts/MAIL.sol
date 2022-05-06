//SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.13;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IMAILDeployer.sol";
import "./interfaces/IOracle.sol";
import "./interfaces/InterestRateModelInterface.sol";
import "./interfaces/IOwnable.sol";

import "./lib/Rebase.sol";
import "./lib/IntMath.sol";
import "./lib/IntERC20.sol";

/**
 * @dev We scale all numbers to 18 decimals to easily work with IntMath library. The toBase functions reads the decimals and scales them. And the fromBase puts them back to their original decimal houses.
 */
contract MAILMarket {
    /*///////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event Accrue(
        address indexed token,
        uint256 cash,
        uint256 interestAccumulated,
        uint256 totalShares,
        uint256 totalBorrow
    );

    event Deposit(
        address indexed from,
        address indexed to,
        address indexed token,
        uint256 amount,
        uint256 rewards
    );

    event Withdraw(
        address indexed from,
        address indexed to,
        address indexed token,
        uint256 amount,
        uint256 rewards
    );

    event GetReserves(
        address indexed token,
        address indexed treasury,
        uint256 indexed amount
    );

    event DepositReserves(
        address indexed token,
        address indexed donor,
        uint256 indexed amount
    );

    event Borrow(
        address indexed borrower,
        address indexed recipient,
        address indexed token,
        uint256 principal,
        uint256 amount
    );

    event Repay(
        address indexed from,
        address indexed account,
        address indexed token,
        uint256 principal,
        uint256 amount
    );

    event Liquidate(
        address indexed borrower,
        address indexed borrowToken,
        address collateralToken,
        uint256 debt,
        uint256 collateralAmount,
        address indexed recipient,
        uint256 reservesAmount
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
                                STRUCTS
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

    address private constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    // Requests
    uint8 private constant ADD_COLLATERAL_REQUEST = 0;

    uint8 private constant WITHDRAW_COLLATERAL_REQUEST = 1;

    uint8 private constant BORROW_REQUEST = 2;

    uint8 private constant REPAY_REQUEST = 3;

    //solhint-disable-next-line var-name-mixedcase
    address private immutable MAIL_DEPLOYER; // Deployer of this contract

    //solhint-disable-next-line var-name-mixedcase
    address private immutable RISKY_TOKEN;

    //solhint-disable-next-line var-name-mixedcase
    address private immutable ORACLE;

    //solhint-disable-next-line var-name-mixedcase
    address private immutable ROUTER;

    //solhint-disable-next-line var-name-mixedcase
    address[] private MARKETS;

    // Token => User => Collateral Balance
    mapping(address => mapping(address => uint256)) public balanceOf;

    // Token => User => Borrow Balance
    mapping(address => mapping(address => uint256)) public borrowOf;

    // Token => Market
    mapping(address => Market) public marketOf;

    // Token => Bool
    mapping(address => bool) public isMarket;

    // Token => User => Account
    mapping(address => mapping(address => Account)) public accountOf;

    // Token => Total Supply
    mapping(address => uint256) public totalSupplyOf;

    /*///////////////////////////////////////////////////////////////
                            CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor() {
        // Type the `msg.sender` to IMAILDeployer
        IMAILDeployer mailDeployer = IMAILDeployer(msg.sender);

        // Get the token addresses from the MAIL Deployer
        address riskyToken = mailDeployer.riskyToken();

        // Update the Global state
        RISKY_TOKEN = riskyToken;
        ORACLE = mailDeployer.ORACLE();
        MAIL_DEPLOYER = msg.sender;
        ROUTER = mailDeployer.ROUTER();

        // Whitelist all tokens supported by this contract

        // BTC
        isMarket[0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599] = true;
        // USDT
        isMarket[0xdAC17F958D2ee523a2206206994597C13D831ec7] = true;
        // USDC
        isMarket[0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48] = true;
        // WETH
        isMarket[WETH] = true;
        // Risky Token
        isMarket[riskyToken] = true;

        // Update the tokens array to easily fetch data about all markets
        // BTC
        MARKETS.push(0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599);
        // USDT
        MARKETS.push(0xdAC17F958D2ee523a2206206994597C13D831ec7);
        // USDC
        MARKETS.push(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);
        // WETH
        MARKETS.push(WETH);
        // Risky Token
        MARKETS.push(riskyToken);
    }

    /*///////////////////////////////////////////////////////////////
                            MODIFIER
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev It guards the contract to only accept supported assets.
     *
     * @param token The token that must be whitelisted.
     */
    modifier isMarketListed(address token) {
        require(isMarket[token], "MAIL: token not listed");
        _;
    }

    /**
     * @dev It guarantees that the user remains solvent after all operations.
     */
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

    /**
     * @dev Allows the `MAIL_DEPLOYER` owner transfer reserves to the treasury.
     *
     * @param token The reserves for a specific asset supported by this contract.
     * @param amount The number of tokens in the reserves to be withdrawn
     *
     * Requirements:
     *
     * - Only the `MAIL_DEPLOYER` owner can withdraw tokens to the treasury.
     * - Only tokens supported by this pool can be withdrawn.
     */
    function getReserves(address token, uint256 amount)
        external
        isMarketListed(token)
    {
        // Type the `MAIL_DEPLOYER` to access its functions
        IMAILDeployer mailDeployer = IMAILDeployer(MAIL_DEPLOYER);

        // Only the owner of `mailDeployer` can send reserves to the treasury as they reduce liquidity and earnings.
        require(
            msg.sender == IOwnable(address(mailDeployer)).owner(),
            "MAIL: only owner"
        );

        // Save storage in memory to save gas.
        Market memory market = marketOf[token];

        // Convert to 18 decimal base number
        uint256 baseAmount = _getBaseAmount(token, amount);

        // Make sure there is enough liquidity in the market
        require(getCash(token) >= baseAmount, "MAIL: not enough cash");
        // Make sure the owner can only take tokens from the reserves
        require(
            market.totalReserves >= baseAmount,
            "MAIL: not enough reserves"
        );

        // Update the total reserves
        market.totalReserves -= baseAmount.toUint128();

        // Update the storage
        marketOf[token] = market;

        // Save the treasury address in memory
        address treasury = mailDeployer.treasury();

        // Transfer the token in the unbase amount to the treasury
        IERC20(token).safeTransfer(treasury, amount);

        // Emit the event
        emit GetReserves(token, treasury, amount);
    }

    /**
     * @dev It allows anyone to deposit directly into the reserves to help the protocol
     *
     * @param token The token, which the donor wants to add to the reserves
     * @param amount The number of `token` that will be added to the reserves.
     *
     * Requirements:
     *
     * - The `msg.sender` must provide allowance beforehand.
     * - Only tokens supported by this pool can be donated to the reserves.
     */
    function despositReserves(address token, uint256 amount)
        external
        isMarketListed(token)
    {
        // Save the market information in memory
        Market memory market = marketOf[token];

        // Convert the amount to a base amount
        uint256 baseAmount = _getBaseAmount(token, amount);

        // Get the tokens from the `msg.sender` in amount.
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // Update the market in information in memory
        market.totalReserves += baseAmount.toUint128();

        // Update in storage
        marketOf[token] = market;

        // Emit the event
        emit DepositReserves(token, msg.sender, amount);
    }

    /**
     * @dev Allows nyone to update the loan data of a market.
     *
     * @param token The market that will have its loan information updated.
     *
     * Requirements:
     *
     * - Token must be listed in this pool; otherwise makes no sense to update an unlisted market.
     */
    function accrue(address token) external isMarketListed(token) {
        // Call the internal {_accrue}.
        _accrue(token);
    }

    /**
     * @dev It allows any account to deposit tokens for the `to` address.
     *
     * @param token The ERC20 the `msg.sender` wishes to deposit
     * @param amount The number of `token` that will be deposited
     * @param to The address that the deposit will be assigned to
     *
     * Requirements:
     *
     * - The `token` must be supported by this contract
     * - The amount cannot be zero
     * - The `to` must not be the zero address to avoid loss of funds
     * - The `token` must be supported by this market.
     * - The `msg.sender` must provide an allowance greater than `amount` to use this function.
     */
    function deposit(
        address token,
        uint256 amount,
        address to
    ) external isMarketListed(token) {
        // Update the debt and rewards of this market
        _accrue(token);

        _deposit(token, amount, msg.sender, to);
    }

    /**
     * @dev Allows the `from` to withdraw `from` his/her tokens or the `router` from `MAIL_DEPLOYER`.
     *
     * @param token The ERC20 token the `msg.sender` wishes to withdraw
     * @param amount The number of `token` the `msg.sender` wishes to withdraw
     * @param to The account, which will receive the tokens
     *
     * Requirements:
     *
     * - Only the `msg.sender` or the `router` can withdraw tokens
     * - The amount has to be greater than 0
     * - The market must have enough liquidity
     * - The `token` must be supported by this market.
     */
    function withdraw(
        address token,
        uint256 amount,
        address to
    ) external isMarketListed(token) isSolvent {
        // Accumulate interest and rewards.
        _accrue(token);

        _withdraw(token, amount, msg.sender, to);
    }

    /**
     * @dev It allows the `msg.sender` or the router to open a loan position for the `from` address.
     *
     * @param token The loan will be issued in this token
     * @param amount Indicates how many `token` the `from` will loan.
     * @param to The account, which will receive the tokens
     *
     * Requirements:
     *
     * - The `from` must be the `msg.sender` or the router.
     * - The `amount` cannot be the zero address
     * - The `token` must be supported by this market.
     * - There must be ebough liquidity to be borrowed.
     */
    function borrow(
        address token,
        uint256 amount,
        address to
    ) external isMarketListed(token) isSolvent {
        // Update the debt and rewards
        _accrue(token);

        _borrow(token, amount, msg.sender, to);
    }

    /**
     * @dev It allows a `msg.sender` to pay the debt of the `to` address
     *
     * @param token The token in which the loan is denominated in
     * @param principal How many shares of the loan will be paid by the `msg.sender`
     * @param to The account, which will have its loan  paid for.
     *
     * Requirements:
     *
     * - The `to` address cannot be the zero address
     * - The `principal` cannot be the zero address
     * - The token must be supported by this contract
     * - The `msg.sender` must approve this contract to use this function
     */
    function repay(
        address token,
        uint256 principal,
        address to
    ) external isMarketListed(token) {
        // Update the debt and rewards
        _accrue(token);

        _repay(token, principal, msg.sender, to);
    }

    function request(
        address from,
        uint8[] calldata requests,
        bytes[] calldata requestArgs
    ) external {
        require(
            msg.sender == from || msg.sender == ROUTER,
            "MAIL: not authorized"
        );
        bool checkForSolvency;

        for (uint256 i; i < requests.length; i++) {
            uint8 requestAction = requests[i];

            if (_checkForSolvency(requestAction)) checkForSolvency = true;

            _request(from, requestAction, requestArgs[i]);
        }

        if (checkForSolvency)
            require(_isSolvent(from), "MAIL: from is insolvent");
    }

    /**
     * @dev This account allows a `msg.sender` to repay an amount of a loan underwater. The `msg.sender` must indicate which collateral token the entity being liquidated will be used to cover the loan. The `msg.sender` must provide the same amount of tokens used to close the account.
     *
     * @param borrower The account that will be liquidated
     * @param borrowToken The market of the loan that will be liquidated
     * @param principal The amount of the loan to be repaid in shares
     * @param collateralToken The market in which the `borrower` has enough collateral to cover the `principal`.
     * @param recipient The account which will be rewarded with this liquidation
     *
     * Requirements:
     *
     * - The `msg.sender` must have enough tokens to cover the `principal` in nominal amount.
     * - This function must liquidate a user. So `principal` has to be greater than 0.
     * - The `borrowToken` must be supported by this market.
     * - The `collateralToken` must be supported by this market.
     */
    function liquidate(
        address borrower,
        address borrowToken,
        uint256 principal,
        address collateralToken,
        address recipient
    ) external {
        // Tokens must exist in the market
        require(isMarket[borrowToken], "MAIL: borrowToken not listed");
        require(isMarket[collateralToken], "MAIL: collateralToken not listed");
        require(recipient != address(0), "MAIL: no zero address recipient");
        require(principal > 0, "MAIL: no zero principal");

        // Update the rewards and debt for this market
        _accrue(borrowToken);

        // Solvent users cannot be liquidated
        require(!_isSolvent(borrower), "MAIL: borrower is solvent");

        // Save total amount nominal amount owed.
        uint256 debt;

        // Uniswap style block scope
        {
            // Store the actual amount to repay
            uint256 principalToRepay;

            // Save storage loan info to memory
            Market memory borrowMarket = marketOf[borrowToken];
            Rebase memory loan = borrowMarket.loan;

            // Uniswap style block scope
            {
                // Save borrower account info in memory
                Account memory account = accountOf[borrowToken][borrower];

                principal = _getBaseAmount(borrowToken, principal);

                // It is impossible to repay more than what the `borrower` owes
                principalToRepay = principal > account.principal
                    ? account.principal
                    : principal;

                // Repays the loan
                account.principal -= principalToRepay.toUint128();

                // Update the global state
                accountOf[borrowToken][borrower] = account;
            }

            // Calculate how much collateral is owed in borrowed tokens.
            debt = loan.toElastic(principalToRepay, false);

            // Uniswap style block scope
            {
                // update the loan information and treats rounding issues.
                if (principalToRepay == loan.base) {
                    loan.sub(loan.base, loan.elastic);
                } else {
                    loan.sub(principalToRepay, debt);
                }

                // Update the state
                borrowMarket.loan = loan;
                marketOf[borrowToken] = borrowMarket;

                // `msg.sender` must provide enough tokens to keep the balance sheet
                IERC20(borrowToken).safeTransferFrom(
                    msg.sender,
                    address(this),
                    debt.fromBase(borrowToken.safeDecimals())
                );
            }
        }

        // Uniswap style block scope
        {
            uint256 collateralToCover;
            uint256 fee = debt.bmul(
                IMAILDeployer(MAIL_DEPLOYER).liquidationFee()
            );

            // if the borrow and collateral token are the same we do not need to do a price convertion.
            if (borrowToken == collateralToken) {
                collateralToCover = debt + fee;
            } else {
                // Fetch the price of the total debt in ETH
                uint256 amountOwedInETH = _getTokenPrice(
                    borrowToken,
                    debt + fee
                );

                // Find the price of one `collateralToken` in ETH.
                uint256 collateralTokenPriceInETH = _getTokenPrice(
                    collateralToken,
                    1 ether
                );

                // Calculate how many collateral tokens we need to cover `amountOwedInETH`.
                collateralToCover = amountOwedInETH.bdiv(
                    collateralTokenPriceInETH
                );
            }

            // Save borrower and recipient collateral market account info in memory
            Account memory borrowerCollateralAccount = accountOf[
                collateralToken
            ][borrower];

            Account memory recipientCollateralAccount = accountOf[
                collateralToken
            ][recipient];

            Market memory collateralMarket = marketOf[collateralToken];

            // Protocol charges a fee for reserves
            uint256 recipientNewAmount = collateralToCover.bmul(
                IMAILDeployer(MAIL_DEPLOYER).liquidatorPortion()
            );

            // Liquidate the borrower and reward the liquidator.
            borrowerCollateralAccount.balance -= collateralToCover.toUint128();
            recipientCollateralAccount.balance += recipientNewAmount
                .toUint128();

            // Pay the reserves
            collateralMarket.totalReserves += (collateralToCover -
                recipientNewAmount).toUint128();

            // Update global state
            marketOf[collateralToken] = collateralMarket;
            accountOf[collateralToken][borrower] = borrowerCollateralAccount;
            accountOf[collateralToken][recipient] = recipientCollateralAccount;

            emit Liquidate(
                borrower,
                borrowToken,
                collateralToken,
                debt,
                collateralToCover,
                recipient,
                collateralToCover - recipientNewAmount
            );
        }
    }

    /*///////////////////////////////////////////////////////////////
                            PRIVATE FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function _request(
        address from,
        uint8 requestAction,
        bytes calldata data
    ) private {
        if (requestAction == ADD_COLLATERAL_REQUEST) {
            (address token, uint256 amount, address to) = abi.decode(
                data,
                (address, uint256, address)
            );
            require(isMarket[token], "MAIL: token not listed");
            _deposit(token, amount, from, to);
            return;
        }

        if (requestAction == WITHDRAW_COLLATERAL_REQUEST) {
            (address token, uint256 amount, address to) = abi.decode(
                data,
                (address, uint256, address)
            );
            require(isMarket[token], "MAIL: token not listed");
            _accrue(token);
            _withdraw(token, amount, from, to);
            return;
        }

        if (requestAction == REPAY_REQUEST) {
            (address token, uint256 principal, address to) = abi.decode(
                data,
                (address, uint256, address)
            );
            require(isMarket[token], "MAIL: token not listed");
            _accrue(token);
            _repay(token, principal, from, to);
            return;
        }

        if (requestAction == BORROW_REQUEST) {
            (address token, uint256 amount, address to) = abi.decode(
                data,
                (address, uint256, address)
            );
            require(isMarket[token], "MAIL: token not listed");
            _accrue(token);
            _borrow(token, amount, from, to);
            return;
        }

        revert("MAIL: invalid request");
    }

    /**
     * @dev Helper function to check if we should check for solvency in the request functions
     *
     * @param __request The request action
     * @return bool if true the function should check for solvency
     */
    function _checkForSolvency(uint8 __request) private pure returns (bool) {
        if (__request == WITHDRAW_COLLATERAL_REQUEST) return true;
        if (__request == BORROW_REQUEST) return true;

        return false;
    }

    /**
     * @dev It allows any account to deposit tokens for the `to` address.
     *
     * @param token The ERC20 the `msg.sender` wishes to deposit
     * @param amount The number of `token` that will be deposited
     * @param from The account that is transferring the tokens
     * @param to The address that the deposit will be assigned to
     *
     * Requirements:
     *
     * - The amount cannot be zero
     * - The `to` must not be the zero address to avoid loss of funds
     * - The `from` must provide an allowance greater than `amount` to use this function.
     */
    function _deposit(
        address token,
        uint256 amount,
        address from,
        address to
    ) private {
        require(amount > 0, "MAIL: no zero deposits");
        require(to != address(0), "MAIL: no zero address deposits");

        // Save storage in memory to save gas
        uint256 totalSupply = totalSupplyOf[token];
        Account memory account = accountOf[token][to];
        uint256 _totalRewards = marketOf[token].totalRewardsPerToken;

        // If the market is empty. There are no rewards or if it is the `to` first deposit.
        uint256 rewards;

        // If the`to` has deposited before. We update the rewards.
        if (account.balance > 0) {
            rewards =
                uint256(account.balance).bmul(_totalRewards) -
                account.rewardDebt;
        }

        // Get tokens from `msg.sender`. It does not have to be the `to` address.
        IERC20(token).safeTransferFrom(from, address(this), amount);

        // All values in this contract use decimals 18.
        uint256 baseAmount = _getBaseAmount(token, amount);

        // We "compound" the rewards to the user to be readily avaliable to be lent.
        uint256 newAmount = baseAmount + rewards;

        // Update Local State
        account.balance += newAmount.toUint128();
        account.rewardDebt = uint256(account.balance).bmul(_totalRewards);
        totalSupply += newAmount;

        // Update Global state
        totalSupplyOf[token] = totalSupply;
        accountOf[token][to] = account;

        // Emit event
        emit Deposit(from, to, token, amount, rewards);
    }

    /**
     * @dev Allows the `from` to withdraw `from` his/her tokens or the `router` from `MAIL_DEPLOYER`.
     *
     * @param token The ERC20 token the `msg.sender` wishes to withdraw
     * @param amount The number of `token` the `msg.sender` wishes to withdraw
     * @param from The account, which will have its token withdrawn
     * @param to The account, which will receive the withdrawn tokens
     *
     * Requirements:
     *
     * - The amount has to be greater than 0
     * - The market must have enough liquidity
     */
    function _withdraw(
        address token,
        uint256 amount,
        address from,
        address to
    ) private {
        // Security checks
        require(amount > 0, "MAIL: no zero withdraws");

        // Save storage in memory to save gas
        uint256 totalSupply = totalSupplyOf[token];
        Account memory account = accountOf[token][from];
        uint256 _totalRewards = marketOf[token].totalRewardsPerToken;

        // Calculate the rewards for the `to` address.
        uint256 rewards = uint256(account.balance).bmul(_totalRewards) -
            account.rewardDebt;

        // All values in this contract use decimals 18
        uint256 baseAmount = _getBaseAmount(token, amount);

        // Make sure the market has enough liquidity
        require(getCash(token) >= baseAmount, "MAIL: not enough cash");

        // Update state in memory
        account.balance -= baseAmount.toUint128();
        account.rewardDebt = uint256(account.balance).bmul(_totalRewards);
        totalSupply -= baseAmount;

        // Update state in storage
        totalSupplyOf[token] = totalSupply;
        accountOf[token][from] = account;

        // Send tokens to `msg.sender`.
        IERC20(token).safeTransfer(
            to,
            amount + rewards.fromBase(token.safeDecimals())
        );

        // emit event
        emit Withdraw(from, to, token, amount, rewards);
    }

    /**
     * @dev It allows the `msg.sender` or the router to open a loan position for the `from` address.
     *
     * @param token The loan will be issued in this token
     * @param amount Indicates how many `token` the `from` will loan.
     * @param from The account that is opening the loan
     * @param to The account, which will receive the tokens
     *
     * Requirements:
     *
     * - The `from` must be the `msg.sender` or the router.
     * - The `amount` cannot be the zero address
     * - The `token` must be supported by this market.
     * - There must be ebough liquidity to be borrowed.
     */
    function _borrow(
        address token,
        uint256 amount,
        address from,
        address to
    ) private {
        // Security checks
        require(amount > 0, "MAIL: no zero withdraws");

        // Make sure the amount has 18 decimals
        uint256 baseAmount = _getBaseAmount(token, amount);

        // Make sure the market has enough liquidity
        require(getCash(token) >= baseAmount, "MAIL: not enough cash");

        // Read from memory
        Account memory account = accountOf[token][from];
        Market memory market = marketOf[token];
        Rebase memory loan = market.loan;

        uint256 principal;

        // Update the state in memory
        (market.loan, principal) = loan.add(baseAmount, true);

        // Update memory
        account.principal += principal.toUint128();

        //  Update storage
        accountOf[token][from] = account;
        marketOf[token] = market;

        // Transfer the loan `token` to the `msg.sender`.
        IERC20(token).safeTransfer(to, amount);

        // Emit event
        emit Borrow(from, to, token, principal, amount);
    }

    /**
     * @dev It allows a `msg.sender` to pay the debt of the `to` address
     *
     * @param token The token in which the loan is denominated in
     * @param principal How many shares of the loan will be paid by the `msg.sender`
     * @param from The account that is paying.
     * @param to The account, which will have its loan  paid for.
     *
     * Requirements:
     *
     * - The `to` address cannot be the zero address
     * - The `principal` cannot be the zero address
     * - The token must be supported by this contract
     * - The `msg.sender` must approve this contract to use this function
     */
    function _repay(
        address token,
        uint256 principal,
        address from,
        address to
    ) private {
        // Security checks read above
        require(principal > 0, "MAIL: principal cannot be 0");
        require(to != address(0), "MAIL: no to zero address");

        // Update the debt and rewards
        _accrue(token);

        // Save storage in memory to save gas
        Market memory market = marketOf[token];
        Rebase memory loan = market.loan;
        Account memory account = accountOf[token][to];
        (Rebase memory _loan, uint256 debt) = loan.sub(principal, true);

        // Get the tokens from `msg.sender`
        IERC20(token).safeTransferFrom(
            from,
            address(this),
            debt.fromBase(token.safeDecimals())
        );

        // Update the state in memory
        market.loan = _loan;
        account.principal -= principal.toUint128();

        // Update the state in storage
        marketOf[token] = market;
        accountOf[token][to] = account;

        // Emit event
        emit Repay(from, to, token, principal, debt);
    }

    /**
     * @dev Helper function to fetch a `token` price from the oracle for an `amount`.
     *
     * @param token An ERC20 token, that we wish to get the price for
     * @param amount The amount of `token` to calculate the price
     * @return The price with 18 decimals in USD for the `token`
     */
    function _getTokenPrice(address token, uint256 amount)
        private
        view
        returns (uint256)
    {
        if (token == WETH) return amount;

        // Risky token uses a different Oracle function
        if (token == RISKY_TOKEN)
            return IOracle(ORACLE).getRiskytokenPrice(token, amount);

        return IOracle(ORACLE).getETHPrice(token, amount);
    }

    /**
     * @dev Helper function to see if a user has enough collateral * LTV to cover his/her loan.
     *
     * @param user The user that is solvent or not
     * @return bool Indicates if a user is solvent or not
     */
    function _isSolvent(address user) private view returns (bool) {
        // Save storage to memory to save gas
        address[] memory tokens = MARKETS;
        address mailDeployer = MAIL_DEPLOYER;
        address riskyToken = RISKY_TOKEN;
        IOracle oracle = IOracle(ORACLE);

        // Total amount of loans in ETH
        uint256 totalDebtInETH;
        // Total collateral in ETH
        uint256 totalCollateralInETH;

        // Need to iterate through all markets to know the total balance sheet of a user.
        for (uint256 i; i < tokens.length; i++) {
            address token = tokens[i];
            Account memory account = accountOf[token][user];

            // If a user does not have any loans or balance we do not need to do anything
            if (account.balance == 0 && account.principal == 0) continue;

            // If the user does has any balance, we need to up his/her collateral.
            if (account.balance > 0) {
                if (token == riskyToken) {
                    // Need to reduce the collateral by the ltv ratio
                    uint256 ltvRatio = IMAILDeployer(mailDeployer)
                        .riskyTokenLTV();
                    totalCollateralInETH += oracle
                        .getRiskytokenPrice(token, uint256(account.balance))
                        .bmul(ltvRatio);
                } else if (token == WETH) {
                    uint256 ltvRatio = IMAILDeployer(mailDeployer).maxLTVOf(
                        token
                    );
                    totalCollateralInETH += uint256(account.balance).bmul(
                        ltvRatio
                    );
                } else {
                    // Need to reduce the collateral by the ltv ratio
                    uint256 ltvRatio = IMAILDeployer(mailDeployer).maxLTVOf(
                        token
                    );
                    totalCollateralInETH += oracle
                        .getETHPrice(token, uint256(account.balance))
                        .bmul(ltvRatio);
                }
            }

            // If the user does not have any open loans, we do not need to do any further calculations.
            if (account.principal == 0) continue;

            Market memory market = marketOf[token];

            // If we already accrued in this block. We do not need to accrue again.
            if (market.lastAccruedBlock != block.number) {
                // If the user has loans. We need to accrue the market first.
                // We get the accrued values without actually accrueing to save gas.
                (market, ) = _viewAccrue(
                    mailDeployer,
                    market,
                    token,
                    getCash(token)
                );
            }

            Rebase memory loan = market.loan;

            // Find out how much the user owes.
            uint256 amountOwed = loan.toElastic(account.principal, true);

            // Update the collateral and debt depending if it is a risky token or not.
            if (token == riskyToken) {
                totalDebtInETH += oracle.getRiskytokenPrice(
                    riskyToken,
                    amountOwed
                );
            } else if (token == WETH) {
                totalDebtInETH += amountOwed;
            } else {
                totalDebtInETH += oracle.getETHPrice(token, amountOwed);
            }
        }

        // If the user has no debt, he is solvent.
        return
            totalDebtInETH == 0 ? true : totalCollateralInETH > totalDebtInETH;
    }

    /**
     * @dev A helper function to scale a number to 18 decimals to easily interact with IntMath
     *
     * @param token The ERC20 associated with the amount. We will read its decimals and scale to 18 decimals
     * @param amount The number to scale up or down
     * @return uint256 The number of tokens with 18 decimals
     */
    function _getBaseAmount(address token, uint256 amount)
        private
        view
        returns (uint256)
    {
        return amount.toBase(token.safeDecimals());
    }

    /**
     * @dev Helper function to update the loan data of the `token` market.
     *
     * @param token The market token
     */
    function _accrue(address token) private {
        // Save storage in memory to save gas
        Market memory market = marketOf[token];
        // If this function is called in the same block. There is nothing to do. As it is updated already.
        if (block.number == market.lastAccruedBlock) return;

        Rebase memory loan = market.loan;

        // If there are no loans. There is nothing else to do. We simply update the storage and return.
        if (loan.base == 0) {
            // Update the lastAccruedBlock in memory to the current block.
            market.lastAccruedBlock = block.number.toUint128();
            marketOf[token] = market;
            return;
        }

        // Find out how much cash we currently have.
        uint256 cash = getCash(token);

        // Interest accumulated for logging purposes.
        uint256 interestAccumulated;

        // Calculate the accrue value and update the storage and update the interest accumulated
        (market, interestAccumulated) = _viewAccrue(
            MAIL_DEPLOYER,
            market,
            token,
            cash
        );

        // Indicate that we have calculated all needed information up to this block.
        market.lastAccruedBlock = block.number.toUint128();

        // Update the storage
        marketOf[token] = market;

        // Emit event
        emit Accrue(token, cash, interestAccumulated, loan.base, loan.elastic);
    }

    /**
     * @dev Helper function to encapsulate the accrue logic in view function to save gas on the {_isSolvent}.
     *
     * @param mailDeployer the deployer of all Mail Pools
     * @param market The current market we wish to know the loan after accrueing the interest rate
     * @param token The token of the `market`.
     * @param cash The current cash in this pool.
     * @return (market, interestAccumulated) The market with its loan updated and the interest accumulated
     */
    function _viewAccrue(
        address mailDeployer,
        Market memory market,
        address token,
        uint256 cash
    ) private view returns (Market memory, uint256) {
        // Save loan in memory
        Rebase memory loan = market.loan;

        // Get the interest rate model for the `token`.
        InterestRateModelInterface interestRateModel = InterestRateModelInterface(
                IMAILDeployer(mailDeployer).getInterestRateModel(token)
            );

        // Calculate the borrow rate per block
        uint256 borrowRatePerBlock = interestRateModel.getBorrowRatePerBlock(
            cash,
            loan.elastic,
            market.totalReserves
        );

        // Make sure it is not very high
        require(
            BORROW_RATE_MAX_MANTISSA > borrowRatePerBlock,
            "MAIL: borrow rate too high"
        );

        // Uniswap block scope style
        {
            // Calculate borrow rate per block with the number of blocks since the last update
            uint256 interestAccumulated = (block.number -
                market.lastAccruedBlock) * borrowRatePerBlock;

            // Calculate the supply rate per block with the number of blocks since the last update
            uint256 rewardsInterestAccumulated = (block.number -
                market.lastAccruedBlock) *
                interestRateModel.getSupplyRatePerBlock(
                    cash,
                    loan.elastic,
                    market.totalReserves,
                    IMAILDeployer(mailDeployer).reserveFactor()
                );

            // Multiply the borrow rate by the total elastic loan to get the nominal value
            uint256 newDebt = interestAccumulated.bmul(loan.elastic);

            // Multiply the supply rate by the total elastic loan to get the nominal value
            uint256 newRewards = rewardsInterestAccumulated.bmul(loan.elastic);

            // The borrow rate total collected must always be higher than the rewards
            assert(newDebt > newRewards);

            // Update the loanin memory.
            (loan, ) = loan.add(newDebt, true);

            // Save storage in memory
            uint256 totalSupply = totalSupplyOf[token];

            // If we have open loans, the total supply must be greater than 0
            assert(totalSupply > 0);

            // Difference between borrow rate and supply rate is the reserves
            market.totalReserves += (newDebt - newRewards).toUint128();
            // Update the calculated information
            market.loan = loan;
            market.totalRewardsPerToken += newRewards.bdiv(totalSupply);

            // Return the pair
            return (market, interestAccumulated);
        }
    }
}
