//SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./interfaces/IMAILDeployer.sol";

contract MAIL {
    //solhint-disable-next-line var-name-mixedcase
    IERC20 private immutable BTC;

    //solhint-disable-next-line var-name-mixedcase
    IERC20 private immutable BRIDGE_TOKEN;

    //solhint-disable-next-line var-name-mixedcase
    IERC20 private immutable USDC;

    //solhint-disable-next-line var-name-mixedcase
    IERC20 private immutable USDT;

    //solhint-disable-next-line var-name-mixedcase
    IERC20 private immutable RISKY_ASSET;

    constructor(
        IERC20 btc,
        IERC20 bridgeToken,
        IERC20 usdc,
        IERC20 usdt,
        IERC20 riskyAsset
    ) {
        BTC = btc;
        BRIDGE_TOKEN = bridgeToken;
        USDC = usdc;
        USDT = usdt;
        RISKY_ASSET = riskyAsset;
    }
}
