// Ensure we are writing the test only for Dev chain

const { assert, expect } = require("chai")
const { getNamedAccounts, deployments, ethers, network } = require("hardhat")
const { isCallTrace } = require("hardhat/internal/hardhat-network/stack-traces/message-trace")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

developmentChains.includes(network.name) 
    ? describe.skip 
    :
    describe("Raffle Unit Tests", async function() {
        let raffle, raffleEntranceFee, deployer

        beforeEach(async function() {
            deployer = (await getNamedAccounts()).deployer
            raffle = await ethers.getContract("Raffle", deployer)
            raffleEntranceFee = await raffle.getEntranceFee()
        })

        describe("fulfilRandomWords", () => {
            it("Works with Live ChainLink Keepers and ChainLink VRF, we get a Random winner", async() => {
                // enter Raffle
                const startingTimeStamp = await raffle.getLatesttimestamp()
                const accounts = await ethers.getSigners() // get accounts

                await new Promise( async( resolve, reject) => {
                    // Setting Up the Listener

                    raffle.once("WinnerPicked", async() => {
                        console.log("WinnerPicked Event Has been Fired...................!!")
                        try {
                            const recentWinner = await raffle.getRecentWinner()
                            const raffleState = await raffle.getRaffleState()
                            const winnerEndingBalance = await accounts[0].getBalance()
                            const endingTimeStamp = await raffle.getLatesttimestamp()

                            await expect(raffle.getPlayer(0)).to.be.reverted // since no player will be in index 0; i.e players object has been reset
                            assert.equal(recentWinner.toString(), accounts[0].address)
                            assert.equal(raffleState, 0)
                            assert.equal(
                                winnerEndingBalance.toString(), 
                                winneStartingBalance
                                .add(raffleEntranceFee)
                                .toString()
                            )
                            assert(endingTimeStamp > startingTimeStamp)

                            resolve()

                        } catch (e) {
                            reject(e)
                        }

                    })

                    // Entering the Raffle
                    await raffle.enterRaffle({ value: raffleEntranceFee })
                    const winneStartingBalance = await accounts[0].getBalance()


                    // This Code wont complete until the Listener has finished listening
                })
                // Setup Listener before we enter the lottery 
                    // just incase the blockchain moves REALLY fast
                // then await raffle.enterRaffle({ value: raffleEntranceFee })
            })
        })
    })