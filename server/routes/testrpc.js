const express = require('express');
const router = express.Router();
const exec = require('child_process').exec;
const config = require('../config.js');

const fs = require('fs');

const Web3 = require('web3');
const TruffleContract = require('truffle-contract');

/* Port number for currently running "testrpc" */
let port = '';
let networkId = '1';

const basePath = '../smart-contracts/build/contracts';

const getContractByName = (jsonFileName, provider) => {
	let json = JSON.parse(fs.readFileSync(`${basePath}/${jsonFileName}`));
	let contract = TruffleContract(json);
	contract.setProvider(provider);
	return contract;
};

const deploy = async (descriptor) => {
	let map = {};
	let provider = descriptor.provider;
	let newArgs = descriptor.newArgs;

	for (let config of descriptor.contracts) {

		let contract = getContractByName(`${config.name}.json`, provider);

		if (config.dependencies) {
			for (let dep of config.dependencies) {
				await contract.detectNetwork();
				contract.link(dep, map[dep].address);
			}
		}

		let args = config.args || [];

		args = args.map( (param) => {
			if (typeof param === 'string' && param.substr(0,2) === '$$') {
				let [dep, prop] = param.substr(2).split('.');
				return map[dep][prop];
			}
			
			return param;
		});

		args.push(newArgs);

		if (config.deploy !== false) {
			let contractInstance = await contract.new.apply(contract, args);
			map[config.name] = contractInstance;
		}
	}

	return map;
};

const deployContracts = async () => {
	return new Promise( async (resolve, reject) => {
		let url = `http://localhost:${port}`;
		let provider = new Web3.providers.HttpProvider(url);
		let web3 = new Web3(provider);

		web3.eth.getAccounts(async (err, accounts) => {

			let from = accounts[0];

			let contractsMap = await deploy({
				provider: provider,
				newArgs: {
					from: from,
					gas: 4712388
				},
				contracts: [{
					name: 'StandardToken',
				}, {
					name: 'HumanStandardToken',
					args: [100000000,"GoNetwork",1,"$GOT"],
					dependencies: ['StandardToken']
				}, {
					name: 'NettingChannelLibrary',
					dependencies: ['StandardToken']
				}, {
					name: 'NettingChannelContract',
					dependencies: ['NettingChannelLibrary'],
					deploy: false
				}, {
					name: 'ChannelManagerLibrary',
					dependencies: ['NettingChannelLibrary']
				}, {
					name: 'ChannelManagerContract',
					dependencies: ['ChannelManagerLibrary'],
					args: ['0x423b5F62b328D0D6D44870F4Eee316befA0b2dF5', '$$HumanStandardToken.address']  
				}]
			});

			resolve(contractsMap);
		});
	});
};


router.post('/start', (req, res) => {
	const params = req.body.params;
	
	let arr = params.split(/ +/);
	let portIndex = arr.indexOf('-p');
	if (portIndex === -1) {
		portIndex = arr.indexOf('--port');
	}
	port = (portIndex === -1) ? '8545' : arr[portIndex + 1];

	proc = exec(`${config.testrpcCmd} ${params} | tee ${config.testrpcOut}`);

	deployContracts().then(() => {
		res.json({ success: true });
	}).catch( (e) => {
		res.status(500).json({ success: false, message: e.message });
	});
});

router.post('/stop', (req, res) => {
	if (!port) {
		res.json({success: false});
		return;
	}

	exec("kill `lsof -i :" + port + " | tail -n 1 | awk  '{print $2}'`");
	port = '';
	res.json({success: true});
});


module.exports = router;
