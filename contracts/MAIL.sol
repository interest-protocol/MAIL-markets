//SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./interfaces/IMAILDeployer.sol";

contract MAIL {
    //solhint-disable-next-line var-name-mixedcase
    address private immutable BTC;

    //solhint-disable-next-line var-name-mixedcase
    address private immutable BRIDGE_TOKEN;

    //solhint-disable-next-line var-name-mixedcase
    address private immutable USDC;

    //solhint-disable-next-line var-name-mixedcase
    address private immutable USDT;

    //solhint-disable-next-line var-name-mixedcase
    address private immutable RISKY_ASSET;

    constructor(
        address btc,
        address bridgeToken,
        address usdc,
        address usdt,
        address riskyAsset
    ) {
        BTC = btc;
        BRIDGE_TOKEN = bridgeToken;
        USDC = usdc;
        USDT = usdt;
        RISKY_ASSET = riskyAsset;
    }
}
