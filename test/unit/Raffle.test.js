// Ensure we are writing the test only for Dev chain

const { assert, expect } = require("chai")
const { getNamedAccounts, deployments, ethers, network } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name) 
    ? describe.skip 
    : describe("Raffle Unit Tests", async function() {
        let raffle, vrfCoordinatorV2Mock, raffleEntranceFee, deployer, interval
        const chainId = network.config.chainId

        beforeEach(async function() {
            deployer = (await getNamedAccounts()).deployer
            await deployments.fixture(["all"])
            raffle = await ethers.getContract("Raffle", deployer)
            vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
            raffleEntranceFee = await raffle.getEntranceFee()
            interval = await raffle.getInterval()
        })

        describe("Constructor", () => {
            it("initializes the Raffle Correctly",  async() => {
                const raffleState = await raffle.getRaffleState()
                assert.equal(raffleState.toString(), "0") // raffle state when called will return a big number.. So we stringify it before use
            })

            it("sets the Raffle interval correctly", async() => {
                assert.equal(interval.toString(), networkConfig[chainId]["interval"])
            })

            it("Sets the right Entrance fee", async() => {
                const entranceFee = await raffle.getEntranceFee()
                assert.equal(entranceFee.toString(), networkConfig[chainId]["entranceFee"])
            })
        })

        describe("enterRaffle", () => {
            it("reverts when you dont pay enough", async() => {
                await expect(raffle.enterRaffle()).to.be.revertedWith(
                    "Raffle__NotEnoughEthEntered()"
                    )
            })

            it("records players when they enter", async() => {
                await raffle.enterRaffle({ value: raffleEntranceFee}) // ensure the correct value has been paid when entering raffle
                const playerFromContract = await raffle.getPlayer(0)
                assert.equal(playerFromContract, deployer) // ensure that the person calling is the deployer at index 0
            })

            it("emits event on enter", async() => {
                await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(raffle, "RaffleEnter")
            })

            it("doesn't allow entrance when Raffle is calculating", async() => {
                await raffle.enterRaffle({ value: raffleEntranceFee })

                // We used network.provider.send() from hardhat to simulate 
                // the passing of the required interval by invoking evm_increaseTime on dev chain 
                // and also mine with evm_mine. This had to be done since the Keeper can only call
                // the upkeep function of the vrfCoordinatorV2 contract when these conditions
                // are fulfilled, which has effectively made the upkeep callable by the keepers contract
                await network.provider.send("evm_increaseTime", [interval.toNumber()+1] )
                await network.provider.send("evm_mine", [])

                // pretend to be the keeper, and call the performUpkeep function. Pass the calldata argument
                // by instantiating an empy array. This effectively causes the raffle to enter CALCULATING state
                await raffle.performUpkeep([]) 
                await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith(
                    "Raffle__NotOpen()"
                )
            })

        })

        describe("checkUpkeep", () => {
            it("returns false if people have not sent any ETH", async() => {
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1 ])
                await network.provider.send("evm_mine", [])
                const { upKeepNeeded } = await raffle.callStatic.checkUpkeep([])
                assert(!upKeepNeeded)
            })

            it("returns false if the Raffle is not open", async() => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.send("evm_mine", [])
                await raffle.performUpkeep("0x")
                const raffleState = await raffle.getRaffleState() // get the state after the contract has stopped accepting players and is performing upkeep
                const { upKeepNeeded } = await raffle.callStatic.checkUpkeep([]) // callstatic on checkupkeep simulates the finished transaction
                assert.equal(raffleState.toString(), "1") // in the Enum in solidity file, 0 = open, and 1 = CALCULATING.Having performed the above logics, the Smartcontract enters Locked state (ie. the calculating state)
                assert.equal(upKeepNeeded, false) // upkeep is only needed is the Raffle is open, so it will return false since its already performing upkeep and Raffle is closed/CALCULATING
            })

            it("Returns false if enough time hasn't passed yet", async() => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() - 1 ])
                await network.provider.send("evm_mine", [])
                const { upKeepNeeded } = await raffle.callStatic.checkUpkeep("0x")
                assert(!upKeepNeeded)
            })

            it("Returns True if enough time has passed, Has players, ETH and is open", async() => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.send("evm_mine", [])
                const { upKeepNeeded } = await raffle.callStatic.checkUpkeep([])
                assert(upKeepNeeded)
            })
        })

        describe("performUpkeep", ()=> {
            it("can only run if checkUpkeep is True", async() => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.send("evm_mine", [])
                const tx = raffle.performUpkeep([])
                assert(tx)
            })

            it("Reverts when checkUpkeep is false", async() => {
                await expect(raffle.performUpkeep([])).to.be.revertedWith(
                    "Raffle__UpKeepNotNeeded"
                )
            })

            it("updates the raffle state, emits an event and calls the vrf coordinator", async() => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.send("evm_mine", [])
                const txResponse = await raffle.performUpkeep([])
                const txReciept = await txResponse.wait(1)
                const requestId = txReciept.events[1].args.requestId
                const raffleState = await raffle.getRaffleState()
                assert(requestId.toNumber() > 0)
                assert(raffleState.toString() == "1")
            })
        })

        describe("fulfilRandomWords", () => {
            // Use a beforeEach block to ensure that someone has entered the raffle first and that all criteria has been met
            beforeEach( async() => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.send("evm_mine", [])
            })

            it("can only be called after performUpkeep", async() => {
                await expect(
                    vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)
                ).to.be.revertedWith("nonexistent request")
                await expect(
                    vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)
                ).to.be.revertedWith("nonexistent request")
            })
            
            it("picks a winner, resets the lottery and sends winner the money", async() => {
                // We will need additional people entering the lottery to simulate effectively
                const additionalEntrants = 3
                const startingAccountsIndex =  1 // since deployer index = 0
                const accounts = await ethers.getSigners()

                for(
                    let i = startingAccountsIndex; 
                    i < startingAccountsIndex + additionalEntrants; 
                    i++
                )  {
                    // connect the new accounts to the raffle account to enter the raffle by predefined indexes
                    const accountsConnectedRaffle = raffle.connect(accounts[i])
                    await accountsConnectedRaffle.enterRaffle({ value: raffleEntranceFee })
                }
                const startingTimeStamp = await raffle.getLatesttimestamp() // keep note of the starting timestamp

                /*   We want to do a couple of things here 
                    in order to pick a winner, send him the lottery balance 
                    and reset the lottery:

                    1. performUpkeep (Mock the Chainlink Keepers)
                    2. Step 1 above will kick off fulfillRandomWords ( Mock being chainLink VRF )
                    3. We will have to wait for fulfillRandomWords to be called if doing this on Live Testnet
                    4. To do no 3 above, we have to set up a listener that waits and listens for the fulfillRandom words to be called 
                    while other logic keeps executing, but listener also enslaves test; to only finish when listener is done listening.
                */
               
                await new Promise(async (resolve, reject) => {
                    // once WinnerPicked event is emitted from vrf tx below, then enforce assertions specified in code block
                    raffle.once("WinnerPicked", async () => { 
                        const recentWinner = await raffle.getRecentWinner()
                        console.log(" WinnerPicked has been Fired!!..................")
                        try {

                            console.log(recentWinner)
                            console.log(accounts[3].address)
                            console.log(accounts[2].address)
                            console.log(accounts[1].address)
                            console.log(accounts[0].address)

                            const raffleState = await raffle.getRaffleState()
                            const endingTimeStamp = await raffle.getLatesttimestamp()
                            const getNumPlayers = await raffle.getNumPlayers()
                            const winnerEndingBalance = await accounts[1].getBalance()

                            assert.equal(getNumPlayers.toString(), "0")
                            assert.equal(raffleState.toString(), "0") // 0 is open state
                            assert(endingTimeStamp > startingTimeStamp) // since latest time stamp ought to have been updated
                            
                            // Winners Final Balance = winner Entrance fee + Entrance Fee * no of unique raffle entrants
                            assert.equal(winnerEndingBalance.toString(), 
                            winnerStartingBalance.add(
                                raffleEntranceFee
                                    .mul(additionalEntrants)
                                    .add(raffleEntranceFee)
                                    .toString()
                                )
                            )
                        } catch (e) {
                            reject(e)
                        }
                        resolve()
                    })

                    // before event gets fired though, we need to performUpkeep and fulfillRandomwords
                    // Its coming inside promise because if its outside Promise, the winner event will
                    // never be emitted, and the promise will never be resolved

                    const tx = await raffle.performUpkeep([])  // chainLink Keepers Mock
                    const txReciept = await tx.wait(1)
                    const winnerStartingBalance = await accounts[1].getBalance()
                    await vrfCoordinatorV2Mock.fulfillRandomWords(
                        txReciept.events[1].args.requestId, 
                        raffle.address
                    )
                })


            })
        })
})