const { network, ethers } = require("hardhat");
const { developmentChains } = require("../helper-hardhat-config")
const BASE_FEE = ethers.utils.parseEther("0.25") // this is the oracle gas fee premium per request
const GAS_PRICE_LINK = 1e9 // a calcullated value based on the gas price of the chain

module.exports = async function ({ getNamedAccounts, deployments }) {
    const { deploy, log } = deployments
    const { deployer } = await getNamedAccounts()
    const args = [BASE_FEE, GAS_PRICE_LINK]

    // Logic to deploy if Dev chain is Localhost
    if (developmentChains.includes(network.name)) {
        log("...Local Network Detected! Deploying Mocks...")

        // deploy a mock vrfCoordinator
        await deploy("VRFCoordinatorV2Mock", {
            from: deployer,
            log: true,
            args: args
        })
        log("Mocks Deployed!")
        log("---------------------------------")
    }
}

module.exports.tags = ["all", "mocks"]