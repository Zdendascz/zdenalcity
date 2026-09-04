import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";
var balance_default = {
	economy: {
		"taxableValuePerUnit": 70,
		"startingFunds": 2e4,
		"defaultTaxRate": 7
	},
	demand: {
		"workerRatio": .5,
		"baseResidential": 20,
		"commercePerCapita": .2,
		"limit": 100
	},
	map: {
		"seaLevel": .28,
		"rockLevel": .9,
		"beachWidth": 2,
		"forestDensity": .35,
		"marshThreshold": .03,
		"octaves": 5,
		"roughness": .5,
		"heightScale": 28,
		"forestScale": 14,
		"scrapIslandTiles": 24,
		"forestAbsorption": .5,
		"clearForestCost": 12,
		"maxLevelledZoneTiles": 64,
		"minLandShare": .97,
		"maxHeight": 10,
		"heightCurve": 1.6,
		"rivers": 2,
		"riverSourceHeight": 5,
		"terraformCost": 8,
		"clearRockCost": 60,
		"fillMarshCost": 40
	},
	traffic: {
		"roadTypes": [
			{
				"id": "street",
				"capacity": 60,
				"cost": 10,
				"upkeep": 1
			},
			{
				"id": "avenue",
				"capacity": 180,
				"cost": 40,
				"upkeep": 3
			},
			{
				"id": "highway",
				"capacity": 480,
				"cost": 120,
				"upkeep": 8
			}
		],
		"attempts": 4,
		"maxSteps": 24,
		"maxBuildingsPerRun": 96,
		"smoothing": .3,
		"transitReduction": .6,
		"bridgeCost": 150
	},
	diffusion: {
		"spread": .4,
		"decay": .94,
		"passes": 2
	},
	landValue: {
		"base": 40,
		"smoothing": .25,
		"waterBonus": 25,
		"weights": {
			"pollution": .8,
			"crime": .7,
			"congestion": 22,
			"forest": 18,
			"sand": -8,
			"prison": -.55,
			"police": .2,
			"fire": .2,
			"health": .3,
			"education": .4,
			"parks": .5,
			"culture": .45,
			"social": .35
		}
	},
	crime: {
		"smoothing": .25,
		"population": .6,
		"unemployment": 40,
		"abandoned": 30,
		"police": .9
	},
	water: {
		"defaultRange": 24,
		"pipeCost": 6,
		"decayStep": 2,
		"abandonAfter": 12
	},
	waste: {
		"perCitizen": .1,
		"toPollution": .02
	},
	sewage: {
		"perCitizen": .14,
		"toPollution": .03
	},
	happiness: {
		"base": 120,
		"smoothing": .2,
		"landValue": .35,
		"pollution": .5,
		"crime": .5,
		"congestion": 20,
		"tax": 2.5,
		"unemployment": 60,
		"minDemandFactor": .3,
		"weights": {
			"parks": .4,
			"culture": .5,
			"social": .5,
			"health": .3,
			"education": .3,
			"police": .2,
			"fire": .15,
			"transit": .25
		}
	},
	health: {
		"coverageThreshold": 20,
		"declineStep": 1,
		"recoveryStep": 1,
		"unservedRatio": .5
	},
	levels: {
		"thresholds": [
			0,
			0,
			90,
			130,
			170,
			210
		],
		"hysteresis": 35,
		"cooldown": 60,
		"downgradeConfirm": 3,
		"decayAge": 3600,
		"decayCoverageThreshold": 20,
		"decayPenalty": 25,
		"demandRelief": 25
	},
	growth: {
		"exponent": 1.5,
		"demandPerAttempt": 8,
		"maxAttempts": 12,
		"neutralTaxRate": 7,
		"taxRange": 20,
		"roadFactors": [
			1,
			1,
			.6,
			.3
		],
		"minAccessFactor": .15,
		"slopeFactor": .7
	},
	finance: {
		"loanIncomeMultiple": 24,
		"maxLoans": 3,
		"minTermMonths": 12,
		"maxTermMonths": 120,
		"baseRate": 4,
		"ratePenalty": 8,
		"missedPenalty": .08,
		"ratingRecovery": .01,
		"bonds": {
			"incomeMultiple": 36,
			"feeRate": .02,
			"referenceRate": 5,
			"maxRate": 20,
			"minMaturityTicks": 1080,
			"maxMaturityTicks": 5400,
			"base": .1,
			"rateWeight": .09,
			"happinessWeight": .5,
			"growthWeight": .6,
			"crimeWeight": .4,
			"debtWeight": .5,
			"defaultPenalty": .5,
			"blockTicks": 1800
		}
	},
	transit: {
		"minStops": 2,
		"maxStops": 12,
		"fareLimit": 40,
		"modes": {
			"bus": {
				"capacity": 40,
				"vehicleCost": 900,
				"vehicleUpkeep": 45,
				"roadShare": 0,
				"needsPower": false
			},
			"tram": {
				"capacity": 90,
				"vehicleCost": 2600,
				"vehicleUpkeep": 110,
				"roadShare": .35,
				"needsPower": true
			},
			"metro": {
				"capacity": 220,
				"vehicleCost": 7e3,
				"vehicleUpkeep": 260,
				"roadShare": 0,
				"needsPower": true
			}
		}
	},
	disasters: /* @__PURE__ */ JSON.parse("{\"maxRiskMultiplier\":3,\"indicators\":{\"uncoveredBelow\":60,\"denseLevel\":4,\"ageTicks\":3600},\"damage\":{\"highLevel\":3},\"rubble\":{\"clearCost\":25,\"crimeWeight\":1.5,\"landValuePenalty\":30},\"flood\":{\"waterRise\":1,\"bayWeight\":4,\"reachMin\":2,\"reachMax\":5,\"advanceTicksMin\":3,\"advanceTicksMax\":6,\"durationMin\":10,\"durationMax\":25,\"drainPerCoverage\":0.04,\"damagePerDepth\":20,\"pollutionPerTick\":5,\"landValuePenalty\":15,\"happinessPerLoss\":3},\"tornado\":{\"speed\":1.5,\"lifetimeMin\":20,\"lifetimeMax\":45,\"widthMin\":2,\"widthMax\":5,\"turnDegrees\":12,\"igniteChance\":0.25,\"igniteIntensity\":110,\"happinessPerLoss\":3,\"survival\":{\"forest\":0.05,\"abandoned\":0.1,\"residentialLow\":0.15,\"residentialHigh\":0.35,\"commercial\":0.4,\"industrial\":0.45,\"service\":0.55,\"utility\":0.55,\"road\":0.7,\"pipe\":0.9,\"rubble\":0.5,\"empty\":1}},\"earthquake\":{\"magnitudeBase\":0.3,\"magnitudeSpan\":0.7,\"falloffShare\":0.7,\"falloffMin\":0.25,\"downgradeShare\":0.6,\"aftershocksMin\":2,\"aftershocksMax\":5,\"aftershockDelayMin\":15,\"aftershockDelayMax\":40,\"aftershockDecay\":0.45,\"fireChance\":0.3,\"floodChance\":0.4,\"floodBand\":3,\"floodDepth\":2,\"floodDuration\":12,\"igniteIntensity\":110,\"happinessPerLoss\":4,\"happinessPerDowngrade\":1,\"vulnerability\":{\"abandoned\":1.3,\"residentialLow\":1,\"utility\":0.9,\"industrial\":0.85,\"commercial\":0.8,\"residentialHigh\":0.75,\"service\":0.7,\"pipe\":0.7,\"road\":0.45,\"forest\":0,\"rubble\":0,\"empty\":0}},\"blast\":{\"resistance\":{\"industrial\":0.15,\"residentialLow\":0.25,\"residentialHigh\":0.25,\"commercial\":0.25,\"abandoned\":0.25,\"service\":0.35,\"utility\":0.35,\"road\":0.6,\"pipe\":0.8,\"forest\":0.1,\"rubble\":0.5,\"empty\":1},\"explosion\":{\"radiusBase\":1,\"radiusPerLevel\":1.5,\"destroyChance\":0.75,\"igniteReach\":1.5,\"igniteChance\":0.5,\"igniteIntensity\":110,\"pollution\":0,\"happinessPerLoss\":3},\"industrialAccident\":{\"radiusBase\":2,\"radiusPerLevel\":2,\"destroyChance\":0.85,\"igniteReach\":1.5,\"igniteChance\":0.45,\"igniteIntensity\":120,\"pollution\":60,\"happinessPerLoss\":3}},\"pileup\":{\"durationBase\":4,\"durationSpan\":6,\"reach\":8,\"jamRadius\":1,\"jamFactor\":4,\"healthFactor\":0.45,\"fireFactor\":0.6,\"happiness\":1,\"populationLoss\":0.05,\"reportLoad\":0.35},\"strike\":{\"durationMin\":20,\"durationMax\":60,\"radiusMin\":6,\"radiusMax\":10,\"drainIdle\":1,\"drainRising\":2,\"crime\":45,\"traffic\":1.6,\"healthFactor\":0.5,\"happiness\":30,\"happinessCity\":5},\"riot\":{\"durationMin\":30,\"durationMax\":70,\"drainIdle\":1,\"drainRising\":1.5,\"drainBoth\":2,\"policeCalm\":120,\"strengthBase\":0.3,\"crime\":60,\"traffic\":0.5,\"healthFactor\":0.55,\"educationFactor\":0.4,\"happiness\":40,\"taxLoss\":0.6,\"igniteEvery\":5,\"igniteMax\":3,\"igniteIntensity\":100,\"escalationCrime\":150,\"escalationChance\":0.25},\"gangWar\":{\"durationMin\":60,\"durationMax\":180,\"radiusMin\":4,\"radiusMax\":7,\"radiusMax2\":10,\"spreadEvery\":20,\"spreadStop\":100,\"drainBase\":0.3,\"pressurePolice\":0.6,\"pressureHappiness\":0.3,\"pressureEmployment\":0.1,\"pressureScale\":2.2,\"crimeFloor\":200,\"happiness\":50,\"happinessCity\":6,\"educationFactor\":0.5,\"healthFactor\":0.75,\"landValue\":25,\"taxLoss\":0.5,\"destroyEvery\":15,\"destroyChance\":0.3,\"happinessPerLoss\":3},\"blackout\":{\"cascadeEvery\":2,\"overloadRatio\":1.15,\"recoveryRatio\":0.95,\"calmCycles\":3,\"noticeTicks\":5,\"happinessPerTick\":1,\"happinessMax\":15,\"penaltyTicks\":30},\"epidemic\":{\"durationMin\":40,\"durationMax\":120,\"cycleTicks\":4,\"seed\":0.35,\"waves\":3,\"waveBase\":0.4,\"spread\":0.25,\"coverageBlock\":0.7,\"jumpChance\":0.3,\"jumpShare\":0.4,\"growth\":0.08,\"decay\":0.05,\"decayPerCoverage\":0.12,\"extinction\":0.02,\"mortality\":0.015,\"overload\":0.7,\"happiness\":35,\"happinessCity\":8},\"landslide\":{\"lengthMin\":2,\"lengthMax\":5,\"widthMin\":1,\"widthMax\":3,\"happinessPerLoss\":3,\"recentTerraformTicks\":360,\"builtWeight\":1.5,\"freshTerraformWeight\":1},\"chemicalSpill\":{\"durationMin\":15,\"durationMax\":40,\"blastRadius\":1,\"sourceDestroyChance\":0.5,\"nearDestroyChance\":0.15,\"pollutionRadius\":3,\"pollution\":45,\"waterRadius\":6,\"waterAfterTicks\":60,\"populationRadius\":5,\"populationLoss\":0.004,\"landValueRadius\":10,\"landValue\":30,\"landValueTicks\":360,\"happiness\":45,\"happinessCity\":10,\"happinessPerLoss\":3,\"heavyLevel\":3,\"ageTicks\":3600,\"ageWeight\":0.8,\"wasteWeight\":3,\"neglectFactor\":1.7},\"fire\":{\"tickInterval\":2,\"suppressBase\":4,\"suppressPerCoverage\":0.1,\"pollutionPerTick\":8,\"happinessPerLoss\":2,\"happinessPenaltyTicks\":120,\"flammability\":{\"forest\":0.55,\"abandoned\":0.45,\"industrial\":0.4,\"residential\":0.3,\"commercial\":0.22,\"service\":0.18,\"utility\":0.18,\"rubble\":0.1},\"fuel\":{\"forest\":6,\"abandoned\":6,\"industrial\":12,\"residential\":8,\"commercial\":10,\"service\":14,\"utility\":14,\"rubble\":4},\"byClass\":{\"parks\":{\"flammability\":0.05,\"fuel\":4}}},\"types\":{\"fire\":{\"burn\":{\"wildfire\":false,\"ignitionIntensity\":100,\"intensityGrowth\":6,\"spreadChance\":0.5,\"minIgnitions\":1,\"maxIgnitions\":3},\"baseMonthlyChance\":0.02,\"maxMonthlyChance\":0.2,\"cooldownTicks\":10,\"natural\":false,\"concurrent\":{\"metric\":\"buildings\",\"divisor\":400,\"min\":1,\"max\":4},\"scale\":{\"metric\":\"buildings\",\"curve\":\"sqrt\",\"divisor\":200,\"offset\":0,\"min\":0.5,\"max\":3},\"require\":[],\"risk\":[{\"indicator\":\"uncovered:fire\",\"weight\":0.9},{\"indicator\":\"crime\",\"weight\":0.6},{\"indicator\":\"neglect\",\"weight\":0.7},{\"indicator\":\"underfunded:fire\",\"weight\":0.5},{\"indicator\":\"industryShare\",\"weight\":0.35}]},\"flood\":{\"baseMonthlyChance\":0.008,\"maxMonthlyChance\":0.03,\"cooldownTicks\":720,\"natural\":true,\"concurrent\":{\"metric\":\"none\",\"divisor\":1,\"min\":1,\"max\":1},\"scale\":{\"metric\":\"coastTiles\",\"curve\":\"linear\",\"divisor\":400,\"offset\":0,\"min\":0.4,\"max\":2.5},\"season\":{\"from\":60,\"to\":150,\"inFactor\":2,\"outFactor\":0.7},\"require\":[{\"metric\":\"coastTiles\",\"min\":1}],\"risk\":[]},\"tornado\":{\"baseMonthlyChance\":0.006,\"maxMonthlyChance\":0.02,\"cooldownTicks\":540,\"natural\":true,\"concurrent\":{\"metric\":\"none\",\"divisor\":1,\"min\":1,\"max\":1},\"scale\":{\"metric\":\"flatShare\",\"curve\":\"linear\",\"divisor\":1,\"offset\":0.5,\"min\":0.5,\"max\":1.5},\"season\":{\"from\":120,\"to\":210,\"inFactor\":2.2,\"outFactor\":0.6},\"require\":[],\"risk\":[]},\"earthquake\":{\"baseMonthlyChance\":0.0025,\"maxMonthlyChance\":0.004,\"cooldownTicks\":2160,\"natural\":true,\"concurrent\":{\"metric\":\"none\",\"divisor\":1,\"min\":1,\"max\":1},\"require\":[],\"risk\":[]},\"pileup\":{\"baseMonthlyChance\":0.05,\"maxMonthlyChance\":0.3,\"cooldownTicks\":15,\"natural\":false,\"concurrent\":{\"metric\":\"roadTiles\",\"divisor\":600,\"min\":1,\"max\":3},\"scale\":{\"metric\":\"roadTiles\",\"curve\":\"sqrt\",\"divisor\":300,\"offset\":0,\"min\":0.5,\"max\":2.5},\"require\":[],\"risk\":[{\"indicator\":\"congestion\",\"weight\":1.1},{\"indicator\":\"majorRoadShare\",\"weight\":0.5},{\"indicator\":\"uncovered:health\",\"weight\":0.3},{\"indicator\":\"underfunded:health\",\"weight\":0.3}]},\"strike\":{\"baseMonthlyChance\":0.025,\"maxMonthlyChance\":0.18,\"cooldownTicks\":90,\"natural\":false,\"concurrent\":{\"metric\":\"none\",\"divisor\":1,\"min\":2,\"max\":2},\"scale\":{\"metric\":\"buildings\",\"curve\":\"sqrt\",\"divisor\":300,\"offset\":0,\"min\":0.5,\"max\":2},\"require\":[{\"metric\":\"population\",\"min\":1800}],\"risk\":[{\"indicator\":\"unemployment\",\"weight\":1.3},{\"indicator\":\"unhappiness\",\"weight\":1},{\"indicator\":\"taxBurden\",\"weight\":0.7},{\"indicator\":\"underfunded:police\",\"weight\":0.6}]},\"riot\":{\"baseMonthlyChance\":0.008,\"maxMonthlyChance\":0.1,\"cooldownTicks\":360,\"natural\":false,\"concurrent\":{\"metric\":\"none\",\"divisor\":1,\"min\":1,\"max\":1},\"scale\":{\"metric\":\"buildings\",\"curve\":\"sqrt\",\"divisor\":400,\"offset\":0,\"min\":0.5,\"max\":2},\"require\":[{\"metric\":\"population\",\"min\":4000}],\"risk\":[{\"indicator\":\"unhappiness\",\"weight\":1.4},{\"indicator\":\"unemployment\",\"weight\":1},{\"indicator\":\"crime\",\"weight\":0.8},{\"indicator\":\"uncovered:police\",\"weight\":0.5},{\"indicator\":\"taxBurden\",\"weight\":0.4}]},\"industrialAccident\":{\"baseMonthlyChance\":0.018,\"maxMonthlyChance\":0.15,\"cooldownTicks\":120,\"natural\":false,\"concurrent\":{\"metric\":\"none\",\"divisor\":1,\"min\":1,\"max\":1},\"scale\":{\"metric\":\"industrialBuildings\",\"curve\":\"sqrt\",\"divisor\":60,\"offset\":0,\"min\":0.4,\"max\":2.5},\"require\":[{\"metric\":\"industrialBuildings\",\"min\":8}],\"risk\":[{\"indicator\":\"uncovered:fire\",\"weight\":1.2},{\"indicator\":\"highLevelShare\",\"weight\":0.8},{\"indicator\":\"underfunded:fire\",\"weight\":0.6},{\"indicator\":\"neglectIndustry\",\"weight\":0.5},{\"indicator\":\"waterless\",\"weight\":0.4}]},\"gangWar\":{\"baseMonthlyChance\":0.02,\"maxMonthlyChance\":0.16,\"cooldownTicks\":150,\"natural\":false,\"concurrent\":{\"metric\":\"buildings\",\"divisor\":900,\"min\":1,\"max\":3},\"scale\":{\"metric\":\"residentialBuildings\",\"curve\":\"sqrt\",\"divisor\":250,\"offset\":0,\"min\":0.5,\"max\":2.2},\"require\":[{\"metric\":\"population\",\"min\":2500}],\"risk\":[{\"indicator\":\"crimeMax\",\"weight\":1.5},{\"indicator\":\"uncovered:police\",\"weight\":0.9},{\"indicator\":\"unemployment\",\"weight\":0.7},{\"indicator\":\"neglect\",\"weight\":0.5},{\"indicator\":\"underfunded:police\",\"weight\":0.4}]},\"explosion\":{\"baseMonthlyChance\":0.03,\"maxMonthlyChance\":0.2,\"cooldownTicks\":45,\"natural\":false,\"concurrent\":{\"metric\":\"none\",\"divisor\":1,\"min\":1,\"max\":1},\"scale\":{\"metric\":\"buildings\",\"curve\":\"sqrt\",\"divisor\":400,\"offset\":0,\"min\":0.4,\"max\":2.2},\"require\":[{\"metric\":\"buildings\",\"min\":60}],\"risk\":[{\"indicator\":\"uncovered:fire\",\"weight\":1},{\"indicator\":\"denseShare\",\"weight\":0.7},{\"indicator\":\"neglect\",\"weight\":0.6},{\"indicator\":\"underfunded:fire\",\"weight\":0.5},{\"indicator\":\"waterless\",\"weight\":0.3}]},\"wildfire\":{\"burn\":{\"wildfire\":true,\"ignitionIntensity\":130,\"intensityGrowth\":9,\"spreadChance\":0.7,\"minIgnitions\":1,\"maxIgnitions\":1},\"baseMonthlyChance\":0.015,\"maxMonthlyChance\":0.08,\"cooldownTicks\":90,\"natural\":true,\"concurrent\":{\"metric\":\"none\",\"divisor\":1,\"min\":1,\"max\":1},\"scale\":{\"metric\":\"forestTiles\",\"curve\":\"linear\",\"divisor\":500,\"offset\":0,\"min\":0.2,\"max\":2.5},\"season\":{\"from\":150,\"to\":240,\"inFactor\":2.5,\"outFactor\":0.5},\"require\":[{\"metric\":\"forestTiles\",\"min\":40}],\"risk\":[]},\"blackout\":{\"baseMonthlyChance\":0.04,\"maxMonthlyChance\":0.45,\"cooldownTicks\":60,\"natural\":false,\"concurrent\":{\"metric\":\"none\",\"divisor\":1,\"min\":1,\"max\":1},\"require\":[{\"metric\":\"powerPlants\",\"min\":1}],\"risk\":[{\"indicator\":\"powerReserve\",\"weight\":8,\"below\":0.25},{\"indicator\":\"singlePlantShare\",\"weight\":0.8},{\"indicator\":\"neglect\",\"weight\":0.3}]},\"epidemic\":{\"baseMonthlyChance\":0.012,\"maxMonthlyChance\":0.1,\"cooldownTicks\":540,\"natural\":false,\"concurrent\":{\"metric\":\"none\",\"divisor\":1,\"min\":1,\"max\":1},\"scale\":{\"metric\":\"population\",\"curve\":\"sqrt\",\"divisor\":3000,\"offset\":0,\"min\":0.4,\"max\":2.5},\"season\":{\"from\":270,\"to\":360,\"inFactor\":1.8,\"outFactor\":0.7},\"require\":[{\"metric\":\"population\",\"min\":3000}],\"risk\":[{\"indicator\":\"uncovered:health\",\"weight\":1.3},{\"indicator\":\"density\",\"weight\":0.9},{\"indicator\":\"waterless\",\"weight\":0.8},{\"indicator\":\"pollution\",\"weight\":0.5},{\"indicator\":\"underfunded:health\",\"weight\":0.5}]},\"landslide\":{\"baseMonthlyChance\":0.02,\"maxMonthlyChance\":0.06,\"cooldownTicks\":180,\"natural\":true,\"concurrent\":{\"metric\":\"none\",\"divisor\":1,\"min\":1,\"max\":1},\"scale\":{\"metric\":\"riskySlopes\",\"curve\":\"linear\",\"divisor\":150,\"offset\":0,\"min\":0,\"max\":3},\"season\":{\"from\":60,\"to\":150,\"inFactor\":2,\"outFactor\":0.6},\"require\":[{\"metric\":\"riskySlopes\",\"min\":1}],\"risk\":[]},\"chemicalSpill\":{\"baseMonthlyChance\":0.014,\"maxMonthlyChance\":0.09,\"cooldownTicks\":300,\"natural\":false,\"concurrent\":{\"metric\":\"none\",\"divisor\":1,\"min\":1,\"max\":1},\"scale\":{\"metric\":\"heavyIndustry\",\"curve\":\"sqrt\",\"divisor\":25,\"offset\":0,\"min\":0.3,\"max\":2.2},\"require\":[{\"metric\":\"heavyIndustry\",\"min\":5}],\"risk\":[{\"indicator\":\"neglectIndustry\",\"weight\":1.1},{\"indicator\":\"uncovered:fire\",\"weight\":0.9},{\"indicator\":\"underfunded:fire\",\"weight\":0.6},{\"indicator\":\"waterless\",\"weight\":0.5},{\"indicator\":\"equipmentAge\",\"weight\":0.4}]}}}")
};
var cinema_default$1 = {
	id: "vanilla:cinema",
	type: "building",
	category: "service",
	menu: "culture",
	name: "building.cinema.name",
	description: "building.cinema.desc",
	footprint: [2, 2],
	construction: {
		"cost": 600,
		"requiresRoad": true,
		"requiresPower": false,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 80 },
	jobs: { "capacity": 8 },
	service: {
		"class": "culture",
		"radius": 6,
		"strength": 55
	},
	graphics: {
		"color": "#7a6fa8",
		"heightLevels": 1,
		"icon": "film"
	}
};
var city_park_default = {
	id: "vanilla:city_park",
	type: "building",
	category: "service",
	menu: "parks",
	name: "building.city_park.name",
	description: "building.city_park.desc",
	footprint: [3, 3],
	construction: {
		"cost": 1300,
		"requiresRoad": true,
		"requiresPower": false,
		"allowsSlope": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 150 },
	jobs: { "capacity": 8 },
	service: {
		"class": "parks",
		"radius": 18,
		"strength": 165
	},
	power: { "consumption": 120 },
	graphics: {
		"color": "#4f8f56",
		"heightLevels": 1,
		"icon": "tree"
	}
};
var clinic_default$1 = {
	id: "vanilla:clinic",
	type: "building",
	category: "service",
	menu: "health",
	name: "building.clinic.name",
	description: "building.clinic.desc",
	footprint: [2, 2],
	construction: {
		"cost": 600,
		"requiresRoad": true,
		"requiresPower": false,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 120 },
	jobs: { "capacity": 12 },
	service: {
		"class": "health",
		"radius": 10,
		"strength": 70
	},
	graphics: {
		"color": "#dfe4ea",
		"heightLevels": 1,
		"icon": "cross"
	}
};
var coal_power_plant_default$1 = {
	id: "vanilla:coal_power_plant",
	type: "building",
	category: "utility",
	menu: "power",
	name: "building.coal_power_plant.name",
	description: "building.coal_power_plant.desc",
	footprint: [5, 5],
	construction: {
		"cost": 8e3,
		"requiresRoad": true,
		"requiresPower": false,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 240 },
	jobs: { "capacity": 20 },
	power: { "production": 24e3 },
	environment: { "pollution": 10 },
	graphics: {
		"color": "#5a5a62",
		"heightLevels": 4,
		"icon": "bolt"
	}
};
var commercial_arcade_default = {
	id: "vanilla:commercial_arcade",
	type: "building",
	category: "commercial",
	name: "building.commercial_arcade.name",
	description: "building.commercial_arcade.desc",
	footprint: [2, 1],
	level: 2,
	construction: {
		"cost": 540,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 28 },
	jobs: { "capacity": 22 },
	power: { "consumption": 520 },
	environment: { "pollution": 3 },
	graphics: {
		"color": "#77c99b",
		"heightLevels": 2
	}
};
var commercial_centre_default = {
	id: "vanilla:commercial_centre",
	type: "building",
	category: "commercial",
	name: "building.commercial_centre.name",
	description: "building.commercial_centre.desc",
	footprint: [2, 2],
	level: 2,
	construction: {
		"cost": 1080,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 56 },
	jobs: { "capacity": 44 },
	power: { "consumption": 1040 },
	environment: { "pollution": 6 },
	graphics: {
		"color": "#66bd8d",
		"heightLevels": 3
	}
};
var commercial_downtown_default = {
	id: "vanilla:commercial_downtown",
	type: "building",
	category: "commercial",
	name: "building.commercial_downtown.name",
	description: "building.commercial_downtown.desc",
	footprint: [3, 3],
	level: 5,
	construction: {
		"cost": 10260,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 513 },
	jobs: { "capacity": 297 },
	power: { "consumption": 7010 },
	environment: { "pollution": 10 },
	graphics: {
		"color": "#40986b",
		"heightLevels": 10
	},
	requirements: {
		"services": { "education": 70 },
		"buildings": []
	}
};
var commercial_gallery_default = {
	id: "vanilla:commercial_gallery",
	type: "building",
	category: "commercial",
	name: "building.commercial_gallery.name",
	description: "building.commercial_gallery.desc",
	footprint: [3, 2],
	level: 3,
	construction: {
		"cost": 2700,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 135 },
	jobs: { "capacity": 102 },
	power: { "consumption": 2410 },
	environment: { "pollution": 6 },
	graphics: {
		"color": "#4faa79",
		"heightLevels": 4
	}
};
var commercial_highrise_default = {
	id: "vanilla:commercial_highrise",
	type: "building",
	category: "commercial",
	name: "building.commercial_highrise.name",
	description: "building.commercial_highrise.desc",
	footprint: [2, 2],
	level: 5,
	construction: {
		"cost": 4560,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 228 },
	jobs: { "capacity": 132 },
	power: { "consumption": 3120 },
	environment: { "pollution": 10 },
	graphics: {
		"color": "#40986b",
		"heightLevels": 8
	},
	requirements: {
		"services": { "education": 70 },
		"buildings": []
	}
};
var commercial_large_default = {
	id: "vanilla:commercial_large",
	type: "building",
	category: "commercial",
	name: "building.commercial_large.name",
	description: "building.commercial_large.desc",
	footprint: [1, 1],
	level: 3,
	construction: {
		"cost": 450,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 21 },
	jobs: { "capacity": 17 },
	power: { "consumption": 390 },
	environment: { "pollution": 2 },
	graphics: {
		"color": "#5fb887",
		"heightLevels": 3
	}
};
var commercial_mall_default = {
	id: "vanilla:commercial_mall",
	type: "building",
	category: "commercial",
	name: "building.commercial_mall.name",
	description: "building.commercial_mall.desc",
	footprint: [3, 3],
	level: 4,
	construction: {
		"cost": 6480,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 324 },
	jobs: { "capacity": 216 },
	power: { "consumption": 5100 },
	environment: { "pollution": 8 },
	graphics: {
		"color": "#48a172",
		"heightLevels": 7
	},
	requirements: {
		"services": { "education": 40 },
		"buildings": []
	}
};
var commercial_medium_default = {
	id: "vanilla:commercial_medium",
	type: "building",
	category: "commercial",
	name: "building.commercial_medium.name",
	description: "building.commercial_medium.desc",
	footprint: [1, 1],
	level: 2,
	construction: {
		"cost": 270,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 14 },
	jobs: { "capacity": 11 },
	power: { "consumption": 260 },
	environment: { "pollution": 1 },
	graphics: {
		"color": "#6fc494",
		"heightLevels": 2
	}
};
var commercial_offices_default = {
	id: "vanilla:commercial_offices",
	type: "building",
	category: "commercial",
	name: "building.commercial_offices.name",
	description: "building.commercial_offices.desc",
	footprint: [2, 2],
	level: 4,
	construction: {
		"cost": 2880,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 144 },
	jobs: { "capacity": 96 },
	power: { "consumption": 2270 },
	environment: { "pollution": 8 },
	graphics: {
		"color": "#48a172",
		"heightLevels": 6
	},
	requirements: {
		"services": { "education": 40 },
		"buildings": []
	}
};
var commercial_plaza_default = {
	id: "vanilla:commercial_plaza",
	type: "building",
	category: "commercial",
	name: "building.commercial_plaza.name",
	description: "building.commercial_plaza.desc",
	footprint: [3, 3],
	level: 3,
	construction: {
		"cost": 4050,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 202 },
	jobs: { "capacity": 153 },
	power: { "consumption": 3610 },
	environment: { "pollution": 6 },
	graphics: {
		"color": "#4faa79",
		"heightLevels": 5
	}
};
var commercial_row_default = {
	id: "vanilla:commercial_row",
	type: "building",
	category: "commercial",
	name: "building.commercial_row.name",
	description: "building.commercial_row.desc",
	footprint: [2, 1],
	level: 1,
	construction: {
		"cost": 300,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 16 },
	jobs: { "capacity": 15 },
	power: { "consumption": 300 },
	environment: { "pollution": 2 },
	graphics: {
		"color": "#84d3a6",
		"heightLevels": 1
	}
};
var commercial_small_default = {
	id: "vanilla:commercial_small",
	type: "building",
	category: "commercial",
	name: "building.commercial_small.name",
	description: "building.commercial_small.desc",
	footprint: [1, 1],
	construction: {
		"cost": 150,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 8 },
	jobs: { "capacity": 6 },
	power: { "consumption": 150 },
	environment: { "pollution": 1 },
	graphics: {
		"color": "#7fcfa0",
		"heightLevels": 1
	}
};
var commercial_tower_default = {
	id: "vanilla:commercial_tower",
	type: "building",
	category: "commercial",
	name: "building.commercial_tower.name",
	description: "building.commercial_tower.desc",
	footprint: [2, 2],
	level: 3,
	construction: {
		"cost": 1800,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 84 },
	jobs: { "capacity": 68 },
	power: { "consumption": 1560 },
	environment: { "pollution": 7 },
	graphics: {
		"color": "#55b180",
		"heightLevels": 5
	}
};
var community_centre_default$1 = {
	id: "vanilla:community_centre",
	type: "building",
	category: "service",
	menu: "social",
	name: "building.community_centre.name",
	description: "building.community_centre.desc",
	footprint: [2, 2],
	construction: {
		"cost": 700,
		"requiresRoad": true,
		"requiresPower": false,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 100 },
	jobs: { "capacity": 10 },
	service: {
		"class": "social",
		"radius": 7,
		"strength": 75
	},
	graphics: {
		"color": "#8fb48f",
		"heightLevels": 1,
		"icon": "people"
	}
};
var fire_station_default$1 = {
	id: "vanilla:fire_station",
	type: "building",
	category: "service",
	menu: "fire",
	name: "building.fire_station.name",
	description: "building.fire_station.desc",
	footprint: [2, 2],
	construction: {
		"cost": 500,
		"requiresRoad": true,
		"requiresPower": false,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 100 },
	jobs: { "capacity": 8 },
	service: {
		"class": "fire",
		"radius": 10,
		"strength": 60
	},
	graphics: {
		"color": "#c05a4a",
		"heightLevels": 1,
		"icon": "flame"
	}
};
var fire_station_large_default$1 = {
	id: "vanilla:fire_station_large",
	type: "building",
	category: "service",
	menu: "fire",
	name: "building.fire_station_large.name",
	description: "building.fire_station_large.desc",
	footprint: [2, 2],
	construction: {
		"cost": 1300,
		"requiresRoad": true,
		"requiresPower": false,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 240 },
	jobs: { "capacity": 22 },
	service: {
		"class": "fire",
		"radius": 16,
		"strength": 110
	},
	power: { "consumption": 440 },
	graphics: {
		"color": "#c2603f",
		"heightLevels": 2,
		"icon": "flame"
	}
};
var gallery_default$1 = {
	id: "vanilla:gallery",
	type: "building",
	category: "service",
	menu: "culture",
	name: "building.gallery.name",
	description: "building.gallery.desc",
	footprint: [1, 1],
	construction: {
		"cost": 300,
		"requiresRoad": true,
		"requiresPower": false,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 40 },
	jobs: { "capacity": 4 },
	service: {
		"class": "culture",
		"radius": 4,
		"strength": 45
	},
	graphics: {
		"color": "#9aa8c4",
		"heightLevels": 1,
		"icon": "frame"
	}
};
var gas_power_plant_default = {
	id: "vanilla:gas_power_plant",
	type: "building",
	category: "utility",
	menu: "power",
	name: "building.gas_power_plant.name",
	description: "building.gas_power_plant.desc",
	footprint: [3, 3],
	construction: {
		"cost": 4500,
		"requiresRoad": true,
		"requiresPower": false,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 420 },
	jobs: { "capacity": 12 },
	power: { "production": 13e3 },
	environment: { "pollution": 4 },
	graphics: {
		"color": "#7a8a94",
		"heightLevels": 3,
		"icon": "bolt"
	}
};
var high_school_default$1 = {
	id: "vanilla:high_school",
	type: "building",
	category: "service",
	menu: "education",
	name: "building.high_school.name",
	description: "building.high_school.desc",
	footprint: [2, 2],
	construction: {
		"cost": 1800,
		"requiresRoad": true,
		"requiresPower": false,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 300 },
	jobs: { "capacity": 26 },
	service: {
		"class": "education",
		"radius": 14,
		"strength": 100
	},
	power: { "consumption": 520 },
	graphics: {
		"color": "#c9b06a",
		"heightLevels": 2,
		"icon": "book"
	}
};
var hospital_default$1 = {
	id: "vanilla:hospital",
	type: "building",
	category: "service",
	menu: "health",
	name: "building.hospital.name",
	description: "building.hospital.desc",
	footprint: [3, 3],
	construction: {
		"cost": 2200,
		"requiresRoad": true,
		"requiresPower": false,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 380 },
	jobs: { "capacity": 40 },
	service: {
		"class": "health",
		"radius": 16,
		"strength": 130
	},
	power: { "consumption": 800 },
	graphics: {
		"color": "#e8e8ec",
		"heightLevels": 3,
		"icon": "cross"
	}
};
var incinerator_default$1 = {
	id: "vanilla:incinerator",
	type: "building",
	category: "service",
	menu: "waste",
	name: "building.incinerator.name",
	description: "building.incinerator.desc",
	footprint: [3, 3],
	construction: {
		"cost": 1500,
		"requiresRoad": true,
		"requiresPower": false,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 250 },
	jobs: { "capacity": 12 },
	waste: { "capacity": 400 },
	environment: { "pollution": 9 },
	graphics: {
		"color": "#6a6a72",
		"heightLevels": 2,
		"icon": "bin"
	}
};
var industrial_chemical_default = {
	id: "vanilla:industrial_chemical",
	type: "building",
	category: "industrial",
	name: "building.industrial_chemical.name",
	description: "building.industrial_chemical.desc",
	footprint: [2, 2],
	level: 3,
	construction: {
		"cost": 2400,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 152 },
	jobs: { "capacity": 132 },
	power: { "consumption": 3120 },
	environment: { "pollution": 59 },
	graphics: {
		"color": "#bfa35f",
		"heightLevels": 4
	}
};
var industrial_complex_default = {
	id: "vanilla:industrial_complex",
	type: "building",
	category: "industrial",
	name: "building.industrial_complex.name",
	description: "building.industrial_complex.desc",
	footprint: [3, 3],
	level: 3,
	construction: {
		"cost": 5400,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 324 },
	jobs: { "capacity": 297 },
	power: { "consumption": 7010 },
	environment: { "pollution": 60 },
	graphics: {
		"color": "#b99a58",
		"heightLevels": 5
	}
};
var industrial_foundry_default = {
	id: "vanilla:industrial_foundry",
	type: "building",
	category: "industrial",
	name: "building.industrial_foundry.name",
	description: "building.industrial_foundry.desc",
	footprint: [2, 2],
	level: 4,
	construction: {
		"cost": 3840,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 230 },
	jobs: { "capacity": 184 },
	power: { "consumption": 4340 },
	environment: { "pollution": 76 },
	graphics: {
		"color": "#b39151",
		"heightLevels": 6
	},
	requirements: {
		"services": { "education": 40 },
		"buildings": []
	}
};
var industrial_hall_default = {
	id: "vanilla:industrial_hall",
	type: "building",
	category: "industrial",
	name: "building.industrial_hall.name",
	description: "building.industrial_hall.desc",
	footprint: [3, 2],
	level: 3,
	construction: {
		"cost": 3600,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 216 },
	jobs: { "capacity": 198 },
	power: { "consumption": 4670 },
	environment: { "pollution": 60 },
	graphics: {
		"color": "#b99a58",
		"heightLevels": 4
	}
};
var industrial_large_default = {
	id: "vanilla:industrial_large",
	type: "building",
	category: "industrial",
	name: "building.industrial_large.name",
	description: "building.industrial_large.desc",
	footprint: [1, 1],
	level: 3,
	construction: {
		"cost": 600,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 38 },
	jobs: { "capacity": 33 },
	power: { "consumption": 780 },
	environment: { "pollution": 15 },
	graphics: {
		"color": "#c5a964",
		"heightLevels": 3
	}
};
var industrial_medium_default = {
	id: "vanilla:industrial_medium",
	type: "building",
	category: "industrial",
	name: "building.industrial_medium.name",
	description: "building.industrial_medium.desc",
	footprint: [1, 1],
	level: 2,
	construction: {
		"cost": 360,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 25 },
	jobs: { "capacity": 21 },
	power: { "consumption": 520 },
	environment: { "pollution": 10 },
	graphics: {
		"color": "#cfb471",
		"heightLevels": 2
	}
};
var industrial_park_default = {
	id: "vanilla:industrial_park",
	type: "building",
	category: "industrial",
	name: "building.industrial_park.name",
	description: "building.industrial_park.desc",
	footprint: [3, 3],
	level: 5,
	construction: {
		"cost": 13680,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 821 },
	jobs: { "capacity": 558 },
	power: { "consumption": 13170 },
	environment: { "pollution": 92 },
	graphics: {
		"color": "#ac884a",
		"heightLevels": 10
	},
	requirements: {
		"services": { "education": 70 },
		"buildings": []
	}
};
var industrial_refinery_default = {
	id: "vanilla:industrial_refinery",
	type: "building",
	category: "industrial",
	name: "building.industrial_refinery.name",
	description: "building.industrial_refinery.desc",
	footprint: [3, 3],
	level: 4,
	construction: {
		"cost": 8640,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 518 },
	jobs: { "capacity": 414 },
	power: { "consumption": 9770 },
	environment: { "pollution": 76 },
	graphics: {
		"color": "#b39151",
		"heightLevels": 7
	},
	requirements: {
		"services": { "education": 40 },
		"buildings": []
	}
};
var industrial_row_default = {
	id: "vanilla:industrial_row",
	type: "building",
	category: "industrial",
	name: "building.industrial_row.name",
	description: "building.industrial_row.desc",
	footprint: [2, 1],
	level: 1,
	construction: {
		"cost": 400,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 28 },
	jobs: { "capacity": 30 },
	power: { "consumption": 600 },
	environment: { "pollution": 14 },
	graphics: {
		"color": "#dcc687",
		"heightLevels": 1
	}
};
var industrial_small_default = {
	id: "vanilla:industrial_small",
	type: "building",
	category: "industrial",
	name: "building.industrial_small.name",
	description: "building.industrial_small.desc",
	footprint: [1, 1],
	construction: {
		"cost": 200,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 14 },
	jobs: { "capacity": 12 },
	power: { "consumption": 300 },
	environment: { "pollution": 7 },
	graphics: {
		"color": "#d9c07f",
		"heightLevels": 1
	}
};
var industrial_smelter_default = {
	id: "vanilla:industrial_smelter",
	type: "building",
	category: "industrial",
	name: "building.industrial_smelter.name",
	description: "building.industrial_smelter.desc",
	footprint: [2, 2],
	level: 5,
	construction: {
		"cost": 6080,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 365 },
	jobs: { "capacity": 248 },
	power: { "consumption": 5850 },
	environment: { "pollution": 92 },
	graphics: {
		"color": "#ac884a",
		"heightLevels": 8
	},
	requirements: {
		"services": { "education": 70 },
		"buildings": []
	}
};
var industrial_works_default = {
	id: "vanilla:industrial_works",
	type: "building",
	category: "industrial",
	name: "building.industrial_works.name",
	description: "building.industrial_works.desc",
	footprint: [2, 2],
	level: 2,
	construction: {
		"cost": 1440,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 100 },
	jobs: { "capacity": 84 },
	power: { "consumption": 2080 },
	environment: { "pollution": 42 },
	graphics: {
		"color": "#caaf6d",
		"heightLevels": 3
	}
};
var industrial_yard_default = {
	id: "vanilla:industrial_yard",
	type: "building",
	category: "industrial",
	name: "building.industrial_yard.name",
	description: "building.industrial_yard.desc",
	footprint: [2, 1],
	level: 2,
	construction: {
		"cost": 720,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 50 },
	jobs: { "capacity": 42 },
	power: { "consumption": 1040 },
	environment: { "pollution": 21 },
	graphics: {
		"color": "#d4bc7b",
		"heightLevels": 2
	}
};
var landfill_default$1 = {
	id: "vanilla:landfill",
	type: "building",
	category: "service",
	menu: "waste",
	name: "building.landfill.name",
	description: "building.landfill.desc",
	footprint: [3, 3],
	construction: {
		"cost": 300,
		"requiresRoad": true,
		"requiresPower": false,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 60 },
	jobs: { "capacity": 4 },
	waste: { "capacity": 120 },
	environment: { "pollution": 21 },
	graphics: {
		"color": "#7a6a4a",
		"heightLevels": 1,
		"icon": "bin"
	}
};
var metro_station_default$1 = {
	id: "vanilla:metro_station",
	type: "building",
	category: "service",
	menu: "transit",
	name: "building.metro_station.name",
	description: "building.metro_station.desc",
	footprint: [2, 2],
	construction: {
		"cost": 1600,
		"requiresRoad": true,
		"requiresPower": true,
		"allowedTerrain": [0]
	},
	economy: { "upkeep": 180 },
	requirements: {
		"services": {},
		"buildings": ["vanilla:transit_depot"]
	},
	transit: { "mode": "metro" },
	power: { "consumption": 120 },
	service: {
		"class": "transit",
		"radius": 6,
		"strength": 160
	},
	graphics: {
		"color": "#4a6fa8",
		"heightLevels": 1,
		"icon": "bus"
	}
};
var museum_default$1 = {
	id: "vanilla:museum",
	type: "building",
	category: "service",
	menu: "culture",
	name: "building.museum.name",
	description: "building.museum.desc",
	footprint: [3, 3],
	construction: {
		"cost": 1400,
		"requiresRoad": true,
		"requiresPower": false,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 180 },
	jobs: { "capacity": 16 },
	service: {
		"class": "culture",
		"radius": 9,
		"strength": 80
	},
	graphics: {
		"color": "#c9b18a",
		"heightLevels": 2,
		"icon": "column"
	}
};
var nuclear_power_plant_default = {
	id: "vanilla:nuclear_power_plant",
	type: "building",
	category: "utility",
	menu: "power",
	name: "building.nuclear_power_plant.name",
	description: "building.nuclear_power_plant.desc",
	footprint: [6, 6],
	construction: {
		"cost": 48e3,
		"requiresRoad": true,
		"requiresPower": false,
		"nearWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 1500 },
	jobs: { "capacity": 60 },
	power: { "production": 12e4 },
	environment: { "pollution": 2 },
	graphics: {
		"color": "#8f9aa2",
		"heightLevels": 3,
		"icon": "bolt"
	}
};
var park_large_default$1 = {
	id: "vanilla:park_large",
	type: "building",
	category: "service",
	menu: "parks",
	name: "building.park_large.name",
	description: "building.park_large.desc",
	footprint: [2, 2],
	construction: {
		"cost": 400,
		"requiresRoad": true,
		"requiresPower": false,
		"allowsSlope": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 60 },
	jobs: { "capacity": 4 },
	service: {
		"class": "parks",
		"radius": 12,
		"strength": 120
	},
	power: { "consumption": 80 },
	graphics: {
		"color": "#5f9a5f",
		"heightLevels": 1,
		"icon": "tree"
	}
};
var park_small_default$1 = {
	id: "vanilla:park_small",
	type: "building",
	category: "service",
	menu: "parks",
	name: "building.park_small.name",
	description: "building.park_small.desc",
	footprint: [1, 1],
	construction: {
		"cost": 100,
		"requiresRoad": false,
		"requiresPower": false,
		"allowsSlope": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 20 },
	service: {
		"class": "parks",
		"radius": 5,
		"strength": 90
	},
	graphics: {
		"color": "#4a9b5a",
		"heightLevels": 1,
		"icon": "tree"
	}
};
var plaza_default = {
	id: "vanilla:plaza",
	type: "building",
	category: "service",
	menu: "parks",
	name: "building.plaza.name",
	description: "building.plaza.desc",
	footprint: [1, 1],
	construction: {
		"cost": 220,
		"requiresRoad": true,
		"requiresPower": false,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 25 },
	jobs: { "capacity": 1 },
	service: {
		"class": "parks",
		"radius": 8,
		"strength": 70
	},
	power: { "consumption": 40 },
	graphics: {
		"color": "#a8a294",
		"heightLevels": 1,
		"icon": "tree"
	}
};
var police_large_default$1 = {
	id: "vanilla:police_large",
	type: "building",
	category: "service",
	menu: "police",
	name: "building.police_large.name",
	description: "building.police_large.desc",
	footprint: [2, 2],
	construction: {
		"cost": 1400,
		"requiresRoad": true,
		"requiresPower": false,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 260 },
	jobs: { "capacity": 24 },
	service: {
		"class": "police",
		"radius": 18,
		"strength": 110
	},
	power: { "consumption": 480 },
	graphics: {
		"color": "#6f7fa8",
		"heightLevels": 2,
		"icon": "shield"
	}
};
var police_small_default$1 = {
	id: "vanilla:police_small",
	type: "building",
	category: "service",
	menu: "police",
	name: "building.police_small.name",
	description: "building.police_small.desc",
	footprint: [2, 2],
	construction: {
		"cost": 500,
		"requiresRoad": true,
		"requiresPower": false,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 100 },
	jobs: { "capacity": 10 },
	service: {
		"class": "police",
		"radius": 12,
		"strength": 60
	},
	graphics: {
		"color": "#6f7fa8",
		"heightLevels": 1,
		"icon": "shield"
	}
};
var prison_default$1 = {
	id: "vanilla:prison",
	type: "building",
	category: "service",
	menu: "police",
	name: "building.prison.name",
	description: "building.prison.desc",
	footprint: [3, 3],
	construction: {
		"cost": 3e3,
		"requiresRoad": true,
		"requiresPower": false,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 420 },
	jobs: { "capacity": 45 },
	service: {
		"class": "police",
		"radius": 22,
		"strength": 140
	},
	nuisance: {
		"class": "prison",
		"radius": 7,
		"strength": 200
	},
	power: { "consumption": 900 },
	graphics: {
		"color": "#8a8a94",
		"heightLevels": 2,
		"icon": "bars"
	}
};
var pump_station_default$1 = {
	id: "vanilla:pump_station",
	type: "building",
	category: "utility",
	menu: "water",
	name: "building.pump_station.name",
	description: "building.pump_station.desc",
	footprint: [1, 1],
	construction: {
		"cost": 250,
		"requiresRoad": false,
		"requiresPower": false,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 25 },
	water: { "range": 20 },
	graphics: {
		"color": "#7fa8c8",
		"heightLevels": 1,
		"icon": "drop"
	}
};
var residential_court_default = {
	id: "vanilla:residential_court",
	type: "building",
	category: "residential",
	name: "building.residential_court.name",
	description: "building.residential_court.desc",
	footprint: [2, 2],
	level: 2,
	construction: {
		"cost": 720,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 40 },
	population: { "capacity": 56 },
	power: { "consumption": 680 },
	environment: { "pollution": 0 },
	graphics: {
		"color": "#74a0d1",
		"heightLevels": 3
	}
};
var residential_estate_default = {
	id: "vanilla:residential_estate",
	type: "building",
	category: "residential",
	name: "building.residential_estate.name",
	description: "building.residential_estate.desc",
	footprint: [3, 3],
	level: 4,
	construction: {
		"cost": 4320,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 216 },
	population: { "capacity": 288 },
	power: { "consumption": 3400 },
	environment: { "pollution": 0 },
	graphics: {
		"color": "#5484bd",
		"heightLevels": 7
	}
};
var residential_highrise_default = {
	id: "vanilla:residential_highrise",
	type: "building",
	category: "residential",
	name: "building.residential_highrise.name",
	description: "building.residential_highrise.desc",
	footprint: [2, 2],
	level: 4,
	construction: {
		"cost": 1920,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 96 },
	population: { "capacity": 128 },
	power: { "consumption": 1510 },
	environment: { "pollution": 0 },
	graphics: {
		"color": "#5484bd",
		"heightLevels": 6
	}
};
var residential_large_default = {
	id: "vanilla:residential_large",
	type: "building",
	category: "residential",
	name: "building.residential_large.name",
	description: "building.residential_large.desc",
	footprint: [1, 1],
	level: 3,
	construction: {
		"cost": 300,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 15 },
	population: { "capacity": 22 },
	power: { "consumption": 260 },
	environment: { "pollution": 0 },
	graphics: {
		"color": "#6f9ccf",
		"heightLevels": 3
	}
};
var residential_medium_default = {
	id: "vanilla:residential_medium",
	type: "building",
	category: "residential",
	name: "building.residential_medium.name",
	description: "building.residential_medium.desc",
	footprint: [1, 1],
	level: 2,
	construction: {
		"cost": 180,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 10 },
	population: { "capacity": 14 },
	power: { "consumption": 170 },
	environment: { "pollution": 0 },
	graphics: {
		"color": "#7fa8d6",
		"heightLevels": 2
	}
};
var residential_quarter_default = {
	id: "vanilla:residential_quarter",
	type: "building",
	category: "residential",
	name: "building.residential_quarter.name",
	description: "building.residential_quarter.desc",
	footprint: [3, 3],
	level: 3,
	construction: {
		"cost": 2700,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 135 },
	population: { "capacity": 198 },
	power: { "consumption": 2340 },
	environment: { "pollution": 0 },
	graphics: {
		"color": "#5c8bc3",
		"heightLevels": 5
	}
};
var residential_row_default = {
	id: "vanilla:residential_row",
	type: "building",
	category: "residential",
	name: "building.residential_row.name",
	description: "building.residential_row.desc",
	footprint: [2, 1],
	level: 1,
	construction: {
		"cost": 200,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 12 },
	population: { "capacity": 20 },
	power: { "consumption": 200 },
	environment: { "pollution": 0 },
	graphics: {
		"color": "#93b8e0",
		"heightLevels": 1
	}
};
var residential_skyline_default = {
	id: "vanilla:residential_skyline",
	type: "building",
	category: "residential",
	name: "building.residential_skyline.name",
	description: "building.residential_skyline.desc",
	footprint: [3, 3],
	level: 5,
	construction: {
		"cost": 6840,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 342 },
	population: { "capacity": 396 },
	power: { "consumption": 4670 },
	environment: { "pollution": 0 },
	graphics: {
		"color": "#4b7cb6",
		"heightLevels": 10
	}
};
var residential_small_default = {
	id: "vanilla:residential_small",
	type: "building",
	category: "residential",
	name: "building.residential_small.name",
	description: "building.residential_small.desc",
	footprint: [1, 1],
	construction: {
		"cost": 100,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 6 },
	population: { "capacity": 8 },
	power: { "consumption": 100 },
	environment: { "pollution": 0 },
	graphics: {
		"color": "#8fb4dd",
		"heightLevels": 1
	}
};
var residential_spire_default = {
	id: "vanilla:residential_spire",
	type: "building",
	category: "residential",
	name: "building.residential_spire.name",
	description: "building.residential_spire.desc",
	footprint: [2, 2],
	level: 5,
	construction: {
		"cost": 3040,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 152 },
	population: { "capacity": 176 },
	power: { "consumption": 2080 },
	environment: { "pollution": 0 },
	graphics: {
		"color": "#4b7cb6",
		"heightLevels": 8
	}
};
var residential_terrace_default = {
	id: "vanilla:residential_terrace",
	type: "building",
	category: "residential",
	name: "building.residential_terrace.name",
	description: "building.residential_terrace.desc",
	footprint: [2, 1],
	level: 2,
	construction: {
		"cost": 360,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 20 },
	population: { "capacity": 28 },
	power: { "consumption": 340 },
	environment: { "pollution": 0 },
	graphics: {
		"color": "#86aed9",
		"heightLevels": 2
	}
};
var residential_terraces_default = {
	id: "vanilla:residential_terraces",
	type: "building",
	category: "residential",
	name: "building.residential_terraces.name",
	description: "building.residential_terraces.desc",
	footprint: [3, 2],
	level: 3,
	construction: {
		"cost": 1800,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 90 },
	population: { "capacity": 132 },
	power: { "consumption": 1560 },
	environment: { "pollution": 0 },
	graphics: {
		"color": "#5c8bc3",
		"heightLevels": 4
	}
};
var residential_tower_default = {
	id: "vanilla:residential_tower",
	type: "building",
	category: "residential",
	name: "building.residential_tower.name",
	description: "building.residential_tower.desc",
	footprint: [2, 2],
	level: 3,
	construction: {
		"cost": 1200,
		"requiresRoad": true,
		"requiresPower": false,
		"requiresWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 60 },
	population: { "capacity": 88 },
	power: { "consumption": 1040 },
	environment: { "pollution": 0 },
	graphics: {
		"color": "#6291c9",
		"heightLevels": 5
	}
};
var retirement_home_default$1 = {
	id: "vanilla:retirement_home",
	type: "building",
	category: "service",
	menu: "social",
	name: "building.retirement_home.name",
	description: "building.retirement_home.desc",
	footprint: [3, 3],
	construction: {
		"cost": 1100,
		"requiresRoad": true,
		"requiresPower": false,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 200 },
	jobs: { "capacity": 14 },
	service: {
		"class": "social",
		"radius": 6,
		"strength": 65
	},
	graphics: {
		"color": "#c4a89a",
		"heightLevels": 2,
		"icon": "heart"
	}
};
var school_default$1 = {
	id: "vanilla:school",
	type: "building",
	category: "service",
	menu: "education",
	name: "building.school.name",
	description: "building.school.desc",
	footprint: [3, 3],
	construction: {
		"cost": 800,
		"requiresRoad": true,
		"requiresPower": false,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 150 },
	jobs: { "capacity": 15 },
	service: {
		"class": "education",
		"radius": 10,
		"strength": 80
	},
	graphics: {
		"color": "#c8a86a",
		"heightLevels": 1,
		"icon": "book"
	}
};
var theatre_default$1 = {
	id: "vanilla:theatre",
	type: "building",
	category: "service",
	menu: "culture",
	name: "building.theatre.name",
	description: "building.theatre.desc",
	footprint: [2, 2],
	construction: {
		"cost": 900,
		"requiresRoad": true,
		"requiresPower": false,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 120 },
	jobs: { "capacity": 12 },
	service: {
		"class": "culture",
		"radius": 7,
		"strength": 70
	},
	graphics: {
		"color": "#b4708f",
		"heightLevels": 1,
		"icon": "masks"
	}
};
var tram_stop_default$1 = {
	id: "vanilla:tram_stop",
	type: "building",
	category: "service",
	menu: "transit",
	name: "building.tram_stop.name",
	description: "building.tram_stop.desc",
	footprint: [1, 1],
	construction: {
		"cost": 400,
		"requiresRoad": true,
		"requiresPower": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 60 },
	requirements: {
		"services": {},
		"buildings": ["vanilla:transit_depot"]
	},
	transit: { "mode": "tram" },
	power: { "consumption": 40 },
	service: {
		"class": "transit",
		"radius": 4,
		"strength": 130
	},
	graphics: {
		"color": "#c75a7a",
		"heightLevels": 1,
		"icon": "bus"
	}
};
var transit_depot_default$1 = {
	id: "vanilla:transit_depot",
	type: "building",
	category: "service",
	menu: "transit",
	name: "building.transit_depot.name",
	description: "building.transit_depot.desc",
	footprint: [3, 3],
	construction: {
		"cost": 900,
		"requiresRoad": true,
		"requiresPower": false,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 150 },
	jobs: { "capacity": 20 },
	graphics: {
		"color": "#c7a45a",
		"heightLevels": 2,
		"icon": "bus"
	}
};
var transit_stop_default$1 = {
	id: "vanilla:transit_stop",
	type: "building",
	category: "service",
	menu: "transit",
	name: "building.transit_stop.name",
	description: "building.transit_stop.desc",
	footprint: [1, 1],
	construction: {
		"cost": 150,
		"requiresRoad": true,
		"requiresPower": false,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 30 },
	requirements: {
		"services": {},
		"buildings": ["vanilla:transit_depot"]
	},
	transit: { "mode": "bus" },
	service: {
		"class": "transit",
		"radius": 3,
		"strength": 110
	},
	graphics: {
		"color": "#5aa9c7",
		"heightLevels": 1,
		"icon": "bus"
	}
};
var university_default$2 = {
	id: "vanilla:university",
	type: "building",
	category: "service",
	menu: "education",
	name: "building.university.name",
	description: "building.university.desc",
	footprint: [3, 3],
	construction: {
		"cost": 4200,
		"requiresRoad": true,
		"requiresPower": false,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 620 },
	jobs: { "capacity": 60 },
	service: {
		"class": "education",
		"radius": 20,
		"strength": 150
	},
	power: { "consumption": 1200 },
	graphics: {
		"color": "#b89a4e",
		"heightLevels": 3,
		"icon": "book"
	}
};
var water_treatment_default$1 = {
	id: "vanilla:water_treatment",
	type: "building",
	category: "utility",
	menu: "water",
	name: "building.water_treatment.name",
	description: "building.water_treatment.desc",
	footprint: [3, 3],
	construction: {
		"cost": 1200,
		"requiresRoad": true,
		"requiresPower": false,
		"nearWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 160 },
	jobs: { "capacity": 12 },
	sewage: { "capacity": 300 },
	environment: { "pollution": 8 },
	graphics: {
		"color": "#6f8f7a",
		"heightLevels": 1,
		"icon": "drop"
	}
};
var water_works_default$1 = {
	id: "vanilla:water_works",
	type: "building",
	category: "utility",
	menu: "water",
	name: "building.water_works.name",
	description: "building.water_works.desc",
	footprint: [3, 3],
	construction: {
		"cost": 800,
		"requiresRoad": true,
		"requiresPower": false,
		"nearWater": true,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 90 },
	jobs: { "capacity": 8 },
	water: {
		"production": 600,
		"range": 24
	},
	graphics: {
		"color": "#5f8fb4",
		"heightLevels": 2,
		"icon": "drop"
	}
};
var wind_turbine_default = {
	id: "vanilla:wind_turbine",
	type: "building",
	category: "utility",
	menu: "power",
	name: "building.wind_turbine.name",
	description: "building.wind_turbine.desc",
	footprint: [1, 1],
	construction: {
		"cost": 900,
		"requiresRoad": false,
		"requiresPower": false,
		"allowedTerrain": [0, 2]
	},
	economy: { "upkeep": 30 },
	power: { "production": 700 },
	graphics: {
		"color": "#e4e8ec",
		"heightLevels": 3,
		"icon": "bolt"
	}
};
var content_city_default = {
	id: "vanilla:grant_content_city",
	type: "grant",
	name: "grant.content_city.name",
	description: "grant.content_city.desc",
	amount: 15e3,
	condition: {
		"metric": "happiness",
		"atLeast": 180,
		"forTicks": 360
	}
};
var first_thousand_default = {
	id: "vanilla:grant_first_thousand",
	type: "grant",
	name: "grant.first_thousand.name",
	description: "grant.first_thousand.desc",
	amount: 8e3,
	condition: {
		"metric": "population",
		"atLeast": 1e3
	}
};
var ten_thousand_default = {
	id: "vanilla:grant_ten_thousand",
	type: "grant",
	name: "grant.ten_thousand.name",
	description: "grant.ten_thousand.desc",
	amount: 4e4,
	condition: {
		"metric": "population",
		"atLeast": 1e4
	}
};
var university_default$1 = {
	id: "vanilla:grant_university",
	type: "grant",
	name: "grant.university.name",
	description: "grant.university.desc",
	amount: 25e3,
	condition: {
		"metric": "building",
		"atLeast": 1,
		"definitionId": "vanilla:university"
	}
};
//#endregion
//#region content/vanilla/locale/cs.json
var cs_default = {
	"building.residential_small.name": "Malý dům",
	"building.residential_small.desc": "Skromné bydlení pro hrstku obyvatel.",
	"building.residential_medium.name": "Patrový dům",
	"building.residential_medium.desc": "Dům, kterému drahá čtvrť přidala patro.",
	"building.residential_large.name": "Nájemní dům",
	"building.residential_large.desc": "Nejvyšší, co se vejde na jedinou parcelu.",
	"building.residential_row.name": "Řadové domy",
	"building.residential_row.desc": "Dvě parcely pod jednou střechou.",
	"building.residential_terrace.name": "Činžovní řada",
	"building.residential_terrace.desc": "Řadovka, které drahá čtvrť přidala patra.",
	"building.residential_court.name": "Obytný dvůr",
	"building.residential_court.desc": "Bloková zástavba s dvorem uvnitř.",
	"building.residential_tower.name": "Věžák",
	"building.residential_tower.desc": "Bydlení pro celou ulici na ploše čtyř parcel.",
	"building.commercial_small.name": "Obchod",
	"building.commercial_small.desc": "Malá prodejna pro okolní čtvrť.",
	"building.commercial_medium.name": "Obchodní dům",
	"building.commercial_medium.desc": "Několik pater obchodu na jediné parcele.",
	"building.commercial_large.name": "Kancelářský dům",
	"building.commercial_large.desc": "Nejvyšší, co se vejde na jedinou parcelu.",
	"building.commercial_row.name": "Obchodní řada",
	"building.commercial_row.desc": "Řada obchodů přes dvě parcely.",
	"building.commercial_arcade.name": "Obchodní pasáž",
	"building.commercial_arcade.desc": "Krytá pasáž přes dvě parcely.",
	"building.commercial_centre.name": "Obchodní centrum",
	"building.commercial_centre.desc": "Obchody, které si přitáhnou půl města.",
	"building.commercial_tower.name": "Kancelářská věž",
	"building.commercial_tower.desc": "Nejvíc pracovních míst, jaké se vejde na čtyři parcely.",
	"building.industrial_small.name": "Dílna",
	"building.industrial_small.desc": "Lehký průmysl. Dává práci, trochu znečišťuje.",
	"building.industrial_medium.name": "Továrna",
	"building.industrial_medium.desc": "Víc práce, víc kouře.",
	"building.industrial_large.name": "Slévárna",
	"building.industrial_large.desc": "Nejtěžší provoz, jaký se vejde na jedinou parcelu.",
	"building.industrial_row.name": "Skladová hala",
	"building.industrial_row.desc": "Hala přes dvě parcely.",
	"building.industrial_yard.name": "Výrobní hala",
	"building.industrial_yard.desc": "Hala, ve které se pracuje na dvě směny.",
	"building.industrial_works.name": "Velká továrna",
	"building.industrial_works.desc": "Stovka míst a kouř, který je cítit přes půl města.",
	"building.industrial_chemical.name": "Chemický závod",
	"building.industrial_chemical.desc": "Nejvíc práce a zdaleka nejvíc znečištění.",
	"building.coal_power_plant.name": "Uhelná elektrárna",
	"building.coal_power_plant.desc": "Levná elektřina za cenu velkého znečištění.",
	"building.police_small.name": "Policejní stanice",
	"building.police_small.desc": "Sráží kriminalitu v okolí a zvedá cenu půdy.",
	"building.fire_station.name": "Hasičská zbrojnice",
	"building.fire_station.desc": "Zvedá cenu půdy v okolí. Zásahy u požárů přijdou s katastrofami.",
	"building.clinic.name": "Klinika",
	"building.clinic.desc": "Zvedá cenu půdy. Bez zdravotní péče obyvatel v okolí ubývá.",
	"building.school.name": "Základní škola",
	"building.school.desc": "Zvedá cenu půdy a otevírá cestu k vyšším úrovním obchodu a průmyslu.",
	"building.park_small.name": "Park",
	"building.park_small.desc": "Levné a jediné, co dělá, je že zvedá cenu půdy v okolí.",
	"building.transit_depot.name": "Vozovna MHD",
	"building.transit_depot.desc": "Sama nic neobsluhuje, ale bez ní se nedá postavit zastávka.",
	"building.transit_stop.name": "Zastávka MHD",
	"building.water_works.name": "Vodárna",
	"building.water_works.desc": "Bere vodu z jezera nebo moře a tlačí ji do potrubí.",
	"building.water_treatment.name": "Čistírna odpadních vod",
	"building.water_treatment.desc": "Zpracuje splašky celého města. Co nestihne, skončí v půdě a v řece.",
	"building.pump_station.name": "Čerpací stanice",
	"building.pump_station.desc": "Sama vodu nevyrábí, ale prodlouží dosah sítě dál od vodárny.",
	"building.transit_stop.desc": "Lidé v okolí přesednou z aut, takže na silnicích ubude dopravy.",
	"building.museum.name": "Muzeum",
	"building.museum.desc": "Sbírka, kvůli které se do města jezdí. Drahá, ale kulturu táhne dál než cokoli jiného.",
	"building.theatre.name": "Divadlo",
	"building.theatre.desc": "Večerní program pro celou čtvrť.",
	"building.cinema.name": "Kino",
	"building.cinema.desc": "Levná kultura pro každý den.",
	"building.gallery.name": "Výstavní síň",
	"building.gallery.desc": "Malá galerie, která oživí i jednu ulici.",
	"building.community_centre.name": "Společenské centrum",
	"building.community_centre.desc": "Místo, kde se čtvrť potká — kroužky, schůze, oslavy.",
	"building.retirement_home.name": "Domov pro seniory",
	"building.retirement_home.desc": "Péče o ty, kteří město postavili.",
	"building.landfill.name": "Skládka",
	"building.landfill.desc": "Levné zpracování odpadu za cenu silného znečištění okolí.",
	"building.incinerator.name": "Spalovna",
	"building.incinerator.desc": "Drahá, ale zpracuje třikrát víc odpadu a znečišťuje méně.",
	"building.residential_terraces.name": "Řadové terasy",
	"building.residential_terraces.desc": "Souvislá řada teras — víc bydlení na stejné ploše.",
	"building.residential_quarter.name": "Obytná čtvrť",
	"building.residential_quarter.desc": "Celý blok bytových domů kolem vnitřního dvora.",
	"building.residential_highrise.name": "Výšková budova",
	"building.residential_highrise.desc": "Bydlení v patrech místo v šířce. Chce dobrou čtvrť.",
	"building.residential_estate.name": "Sídliště",
	"building.residential_estate.desc": "Velký obytný celek — nejvíc lidí na dlaždici, jaký jde postavit.",
	"building.residential_spire.name": "Rezidenční věž",
	"building.residential_spire.desc": "Prestižní adresa. Vyroste jen tam, kde je opravdu draho.",
	"building.residential_skyline.name": "Panorama",
	"building.residential_skyline.desc": "Vrchol obytné zástavby. Bez špičkové čtvrti nevznikne.",
	"building.commercial_gallery.name": "Obchodní pasáž",
	"building.commercial_gallery.desc": "Krytá pasáž s obchody po obou stranách.",
	"building.commercial_plaza.name": "Obchodní náměstí",
	"building.commercial_plaza.desc": "Blok obchodů kolem náměstí.",
	"building.commercial_offices.name": "Kancelářská budova",
	"building.commercial_offices.desc": "Kanceláře místo krámů — víc míst, vyšší nároky.",
	"building.commercial_mall.name": "Nákupní centrum",
	"building.commercial_mall.desc": "Velké nákupní centrum. Táhne dopravu z celého města.",
	"building.commercial_highrise.name": "Kancelářská věž",
	"building.commercial_highrise.desc": "Věž plná kanceláří v nejdražší části města.",
	"building.commercial_downtown.name": "Obchodní centrum města",
	"building.commercial_downtown.desc": "Srdce obchodu. Nejvyšší úroveň komerční zástavby.",
	"building.industrial_hall.name": "Výrobní hala",
	"building.industrial_hall.desc": "Dlouhá hala pro sériovou výrobu.",
	"building.industrial_complex.name": "Průmyslový komplex",
	"building.industrial_complex.desc": "Několik provozů pod jednou správou.",
	"building.industrial_foundry.name": "Slévárna",
	"building.industrial_foundry.desc": "Těžký provoz — hodně míst, hodně špíny.",
	"building.industrial_refinery.name": "Rafinerie",
	"building.industrial_refinery.desc": "Velký chemický provoz. Znečišťuje široké okolí.",
	"building.industrial_smelter.name": "Huť",
	"building.industrial_smelter.desc": "Nejtěžší provoz, jaký jde postavit.",
	"building.industrial_park.name": "Průmyslový park",
	"building.industrial_park.desc": "Rozsáhlý areál na okraji města.",
	"building.police_large.name": "Policejní ředitelství",
	"building.police_large.desc": "Větší dosah i síla než stanice, ale i podstatně vyšší údržba.",
	"building.fire_station_large.name": "Velká hasičská zbrojnice",
	"building.fire_station_large.desc": "Pokryje i čtvrti, kam malá zbrojnice nedosáhne.",
	"building.hospital.name": "Nemocnice",
	"building.hospital.desc": "Bez zdravotnictví obyvatel ubývá; nemocnice pokryje celé město.",
	"building.high_school.name": "Střední škola",
	"building.high_school.desc": "Vyšší vzdělání otevírá cestu k lepším obchodům a provozům.",
	"building.university.name": "Vysoká škola",
	"building.university.desc": "Nejvyšší vzdělání ve městě. Drahá, ale bez ní se nedostaneš nejvýš.",
	"building.park_large.name": "Velký park",
	"building.park_large.desc": "Zvedá cenu půdy v širokém okolí a nestojí skoro nic.",
	"building.prison.name": "Věznice",
	"building.prison.desc": "Srazí kriminalitu v celém městě — a cenu půdy všude, kam je na ni vidět.",
	"ui.tool.road": "Silnice",
	"ui.tool.road.street": "Ulice",
	"ui.tool.road.avenue": "Třída",
	"ui.tool.road.highway": "Dálnice",
	"ui.tool.pipe": "Potrubí",
	"ui.tool.zone.clear": "Zrušit zónu",
	"ui.tool.bulldoze": "Bourání",
	"ui.tool.terrain.raise": "Zvednout terén",
	"ui.tool.terrain.lower": "Snížit terén",
	"ui.tool.terrain.level": "Srovnat terén",
	"ui.tool.terrain.fill": "Dozdít svah",
	"ui.tool.zone.residential": "Obytná zóna",
	"ui.tool.zone.commercial": "Komerční zóna",
	"ui.tool.zone.industrial": "Průmyslová zóna",
	"ui.menu.road": "Silnice",
	"ui.menu.terrain": "Terén",
	"ui.menu.zone": "Zóny",
	"ui.menu.power": "Energetika",
	"ui.menu.water": "Vodovod",
	"ui.menu.waste": "Odpady",
	"ui.menu.police": "Policie",
	"ui.menu.fire": "Hasiči",
	"ui.menu.health": "Zdravotnictví",
	"ui.menu.education": "Vzdělání",
	"ui.menu.parks": "Parky",
	"ui.menu.culture": "Kultura",
	"ui.menu.social": "Sounáležitost",
	"ui.menu.transit": "MHD",
	"ui.menu.utility": "Infrastruktura",
	"ui.menu.service": "Služby",
	"ui.newGame.title": "Nové město",
	"ui.newGame.cityName": "Jméno města",
	"ui.newGame.defaultCityName": "Nový Brod",
	"ui.newGame.seed": "Seed mapy",
	"ui.newGame.size": "Velikost mapy",
	"ui.newGame.size.heavy": "Největší mapa je šestnáctkrát větší než výchozí — na slabším stroji může škubat.",
	"ui.newGame.disasters": "Katastrofy",
	"ui.alert.title": "{name}!",
	"ui.alert.show": "Ukázat",
	"ui.alert.ignore": "Ignorovat",
	"ui.alert.body.fire": "Ve městě hoří. Oheň se šíří po sousedních dlaždicích a zastaví ho jen silnice, voda nebo průsek buldozerem. Hasiči pomůžou jen tam, kam dosáhnou.",
	"ui.alert.body.wildfire": "Hoří les. Než se oheň dostane k zástavbě, je čas prosekat mu cestu — potom už bude pozdě.",
	"ui.alert.body.flood": "Voda stoupá a zaplavuje nížinu. Zatopené budovy chátrají, dokud voda neopadne. Vyvýšený břeh ji zastaví.",
	"ui.alert.body.tornado": "Tornádo prochází městem a bere, co mu stojí v cestě. Zastavit nejde, jen uklidit, co po něm zbude.",
	"ui.alert.body.earthquake": "Zemětřesení. Domy padají nebo se propadají o patro, silnice a potrubí praskají. Vysoká zástavba to snese líp než nízká.",
	"ui.alert.body.explosion": "Výbuch. Okolí je srovnané se zemí a hoří.",
	"ui.alert.body.industrialAccident": "Havárie v průmyslu. Okolí zasáhl výbuch a požár.",
	"ui.alert.body.pileup": "Hromadná nehoda blokuje silnici. Doprava kolem stojí, dokud se to neuklidí.",
	"ui.alert.body.strike": "Ve čtvrti se stávkuje. Služby tam nefungují a spokojenost klesá, dokud se poměry nezlepší. Neřešená stávka umí přerůst v nepokoje.",
	"ui.alert.body.riot": "Občanské nepokoje. Čtvrť je mimo kontrolu, cena půdy padá a policie má co dělat.",
	"ui.alert.body.gangWar": "Válka gangů. Nic se nezboří, ale čtvrť se trvale zhorší — kriminalita nahoru, cena půdy dolů.",
	"ui.alert.body.blackout": "Blackout. Elektrárny odpadly a bez proudu nefungují ani služby, takže riziko všeho ostatního prudce stouplo.",
	"ui.alert.body.epidemic": "Epidemie. Nemoc se šíří mezi obyvateli a lidé umírají. Zastaví ji jen dost velké pokrytí zdravotnictvím.",
	"ui.alert.body.chemicalSpill": "Chemická havárie. Vodárna je mimo provoz a okolí zůstane otrávené i po tom, co únik skončí.",
	"ui.alert.body.landslide": "Sesuv půdy. Svah se utrhl a vzal s sebou, co na něm stálo.",
	"ui.disaster.title": "Katastrofy",
	"ui.disaster.armed": "{name}: klikni na mapu, kde má udeřit.",
	"ui.disaster.started": "Spuštěno: {name}.",
	"ui.disaster.fire": "Požár",
	"ui.disaster.flood": "Povodeň",
	"ui.disaster.tornado": "Tornádo",
	"ui.disaster.earthquake": "Zemětřesení",
	"ui.disaster.pileup": "Hromadná nehoda",
	"ui.disaster.strike": "Stávka",
	"ui.disaster.riot": "Občanské nepokoje",
	"ui.disaster.industrialAccident": "Průmyslová havárie",
	"ui.disaster.gangWar": "Válka gangů",
	"ui.disaster.blackout": "Blackout",
	"ui.disaster.epidemic": "Epidemie",
	"ui.disaster.chemicalSpill": "Chemická havárie",
	"ui.disaster.explosion": "Výbuch",
	"ui.disaster.wildfire": "Lesní požár",
	"ui.disaster.landslide": "Sesuv půdy",
	"ui.newGame.reroll": "Jiná mapa",
	"ui.newGame.start": "Založit město",
	"ui.newGame.resume": "Pokračovat",
	"ui.newGame.stats": "Souše {land} %, vygenerováno za {ms} ms.",
	"ui.hud.funds": "Kasa",
	"ui.hud.population": "Obyvatel",
	"ui.hud.happiness": "Spokojenost",
	"ui.hud.jobs": "Práce",
	"ui.hud.balance": "Měsíční bilance",
	"ui.hud.dateLabel": "Datum",
	"ui.hud.date": "Rok {year}, měsíc {month}, den {day}",
	"ui.hud.demand": "Poptávka",
	"ui.hud.powered": "Pod proudem",
	"ui.hud.power": "Proud",
	"ui.notice.powerShortage": "Elektrárny nestačí: vyrábíš {produced}, město potřebuje {needed}. Postav další elektrárnu.",
	"ui.demand.residential": "O",
	"ui.demand.commercial": "K",
	"ui.demand.industrial": "P",
	"ui.speed.label": "Rychlost",
	"ui.speed.pause": "Pauza",
	"ui.speed.value": "{speed}×",
	"ui.funding.title": "Financování služeb",
	"ui.service.police": "Policie",
	"ui.service.fire": "Hasiči",
	"ui.service.health": "Zdravotnictví",
	"ui.service.education": "Vzdělání",
	"ui.service.parks": "Parky",
	"ui.service.transit": "MHD",
	"ui.service.culture": "Kultura",
	"ui.service.social": "Sounáležitost",
	"ui.tax.title": "Daňové sazby",
	"ui.tax.decrease": "Snížit sazbu",
	"ui.tax.increase": "Zvýšit sazbu",
	"ui.save.title": "Uložení",
	"ui.save.quicksave": "Rychlé uložení",
	"ui.save.quickload": "Rychlé načtení",
	"ui.save.download": "Uložit do souboru",
	"ui.save.open": "Načíst ze souboru",
	"ui.save.saved": "Uloženo ({size} kB)",
	"ui.save.loaded": "Načteno",
	"ui.save.storeFailed": "Uložit se nepovedlo — úložiště prohlížeče je plné nebo vypnuté.",
	"ui.save.empty": "Zatím není co načíst",
	"ui.save.failed": "Save se nepodařilo přečíst: {reason}",
	"ui.save.noWaterNetwork": "Načtené město nemá vodovod: {count} budov začne bez vody chátrat. Postav vodárnu a potrubí.",
	"ui.notice.bankrupt": "Kasa je v mínusu — dokud v ní nebude aspoň nula, nic nového nevyroste. Zbourej, co nepotřebuješ, nebo zvyš daně.",
	"ui.save.missingContent": "Chybí obsah: {list}",
	"ui.cost.spent": "−{amount}",
	"ui.price.withLevelling": "{total} (z toho {levelling} za srovnání)",
	"ui.budget.toggle": "Ekonomika",
	"ui.budget.title": "Ekonomický přehled",
	"ui.budget.building": "Budova",
	"ui.budget.cost": "Cena",
	"ui.budget.count": "Počet",
	"ui.budget.powered": "Pod proudem",
	"ui.budget.income": "Příjem",
	"ui.budget.upkeep": "Údržba",
	"ui.budget.net": "Čistě",
	"ui.budget.transit": "MHD",
	"ui.budget.debt": "Splátky půjček",
	"grant.first_thousand.name": "Dotace: první tisícovka",
	"grant.first_thousand.desc": "Za tisíc obyvatel. Kraj přispěl na rozvoj.",
	"grant.ten_thousand.name": "Dotace: desetitisícové město",
	"grant.ten_thousand.desc": "Za deset tisíc obyvatel. Stát si všiml, že tu něco roste.",
	"grant.university.name": "Dotace: vysoká škola",
	"grant.university.desc": "Za první vysokou školu ve městě.",
	"grant.content_city.name": "Dotace: spokojené město",
	"grant.content_city.desc": "Za rok vysoké spokojenosti v kuse.",
	"error.noFinanceRules": "Finanční pravidla nejsou načtená.",
	"error.invalidAmount": "Neplatná částka.",
	"error.invalidTerm": "Doba splácení musí být {min} až {max} měsíců.",
	"error.tooManyLoans": "Víc než {max} půjček naráz nejde.",
	"error.overLoanCap": "Nad strop. Půjčit si jde nejvýš {cap}.",
	"ui.budget.bonds": "Dluhopisy",
	"error.bondsBlocked": "Po nesplacené emisi je trh zavřený do tiku {until}.",
	"error.overBondCap": "Nad strop. Nabídnout jde nejvýš {cap}.",
	"error.invalidRate": "Úrok musí být 0 až {max} procent.",
	"error.invalidMaturity": "Splatnost musí být {min} až {max} tiků.",
	"error.cannotAffordFee": "Na poplatek za vydání ({fee}) město nemá.",
	"ui.budget.roads": "Silnice",
	"ui.budget.total": "Celkem za měsíc",
	"ui.budget.funds": "Stav kasy: {funds}. Temná budova nevydělává ani nestojí údržbu.",
	"ui.budget.unit.population": "obyvatel",
	"ui.budget.unit.jobs": "prac. míst",
	"ui.budget.formula.tax": "daň: {base} {unit} × {value} × {rate} % = {income}",
	"ui.budget.formula.upkeep": "údržba: {count} × {each} = {total}",
	"ui.budget.formula.idle": "{count} mimo provoz (bez proudu)",
	"ui.info.position": "Pozice",
	"ui.info.footprint": "Půdorys",
	"ui.info.level": "Úroveň",
	"ui.info.built": "Postaveno",
	"ui.info.cost": "Pořizovací cena",
	"ui.info.powerProduction": "Výroba elektřiny",
	"ui.info.powerConsumption": "Spotřeba elektřiny",
	"ui.info.powered": "Připojeno",
	"ui.info.poweredYes": "ano",
	"ui.info.poweredNo": "ne",
	"ui.info.monthlyIncome": "Daně za měsíc",
	"ui.info.monthlyUpkeep": "Údržba za měsíc",
	"ui.info.monthlyNet": "Čistě za měsíc",
	"ui.info.pollution": "Znečištění",
	"ui.info.requirements": "Podmínky",
	"ui.info.unknownDefinition": "Tuhle budovu neumí žádný načtený obsah popsat — nejspíš chybí mod.",
	"ui.info.abandonedWarning": "Budova je opuštěná. Nic nevydělává, nic nestojí a kazí okolí — sama nezmizí, musíš ji zbourat.",
	"ui.info.noPowerWarning": "Bez proudu je budova mimo provoz: nevydělává, ale ani nic nestojí.",
	"ui.info.dryRelayWarning": "K téhle čerpací stanici voda nedoteče, takže síť neprodlužuje. Stanice není zdroj — musí stát na potrubí, kam voda došla.",
	"error.outOfBounds": "Mimo mapu.",
	"error.water": "Na vodu se stavět nedá.",
	"error.roadDowngrade": "Silnici nejde snížit. Zbourej ji a postav znovu.",
	"error.roadExists": "Silnice už tady je.",
	"error.roadInTheWay": "Překáží silnice.",
	"error.rubbleInTheWay": "Překážejí trosky — nejdřív je ukliď buldozerem.",
	"error.occupied": "Dlaždice je obsazená.",
	"error.occupiedFootprint": "Nevejde se sem. Tahle budova potřebuje volných {width} × {depth} dlaždic.",
	"error.nothingToBulldoze": "Není tu co bourat.",
	"error.needsWater": "Bez vodovodu se tu stavět nedá. Doveď sem potrubí.",
	"error.needsShore": "Vodárna musí stát u vody.",
	"error.noPipe": "Tady žádné potrubí není.",
	"error.pipeExists": "Potrubí už tady je.",
	"error.pipeOnWater": "Na vodě potrubí nedrží.",
	"error.terraformWater": "Zvedat dno moře neumíme.",
	"error.terraformNoChange": "Tady už je terén přesně takhle.",
	"error.notFlat": "Na svahu se stavět nedá. Nejdřív parcelu srovnej.",
	"error.bridgeNeedsBank": "Most musí začínat na břehu, ne uprostřed vody.",
	"error.needsRoad": "Musí sousedit se silnicí.",
	"error.needsPower": "Potřebuje připojení k proudu.",
	"error.requiresService": "Chybí tu {service} — potřebuje pokrytí aspoň {needed}.",
	"error.requiresBuilding": "Nejdřív musí ve městě stát {id}.",
	"error.terrainNotAllowed": "Na tenhle terén se to postavit nedá.",
	"error.wrongZone": "Celý půdorys musí ležet ve stejné zóně.",
	"building.tram_stop.name": "Tramvajová zastávka",
	"building.tram_stop.desc": "Zastávka tramvajové linky. Koleje sdílí vozovku a ubírají jí kapacitu.",
	"building.metro_station.name": "Stanice metra",
	"building.metro_station.desc": "Stanice metra. Silnice nezatěžuje vůbec, ale stojí nejvíc.",
	"error.unknownTransitMode": "Neznámý mód dopravy: {mode}.",
	"error.unknownLine": "Taková linka neexistuje.",
	"error.notAStop": "Tahle budova není zastávka.",
	"error.wrongStopMode": "Zastávka je pro {mode}, linka jezdí {expected}.",
	"error.stopAlreadyOnLine": "Zastávka už na lince je.",
	"error.stopNotOnLine": "Zastávka na lince není.",
	"error.tooManyStops": "Linka pojme nejvýš {max} zastávek.",
	"error.invalidVehicles": "Neplatný počet vozidel.",
	"error.invalidFare": "Neplatné jízdné.",
	"error.notEnoughFunds": "Chybí peníze: stojí to {cost}, v kase je {funds}.",
	"error.unknownDefinition": "Neznámá definice {id}.",
	"error.zoneNoChange": "Zóna se sem vyznačit nedá.",
	"error.notAZone": "Tohle není zóna.",
	"error.invalidFunding": "Neplatná výše financování.",
	"error.unknownSpeed": "Neznámá rychlost {speed}.",
	"error.crash": "Chyba v běhu hry: {message}",
	"ui.parcel.title": "Rozbor parcely",
	"ui.parcel.road": "Silnice",
	"ui.parcel.water": "Voda",
	"ui.parcel.surface": "Povrch",
	"ui.terrain.grass": "Tráva",
	"ui.terrain.water": "Voda",
	"ui.terrain.sand": "Písek",
	"ui.terrain.rock": "Skála",
	"ui.terrain.forest": "Les",
	"ui.terrain.marsh": "Mokřad",
	"ui.parcel.blocked.noZone": "Bez zóny se tu nic nepostaví.",
	"ui.parcel.blocked.bankrupt": "Kasa je v mínusu — dokud v ní nebude aspoň nula, nic nevyroste.",
	"ui.parcel.blocked.noDemand": "Po téhle zóně teď není poptávka.",
	"ui.parcel.blocked.zoneTooSmall": "Zóna je mělčí, než co se do ní vejde. Rozšiř ji aspoň na hloubku budovy.",
	"ui.parcel.blocked.tooFarFromRoad": "Moc daleko od silnice.",
	"ui.parcel.blocked.noDefinition": "Pro tuhle zónu není co postavit.",
	"ui.notice.nothingGrows": "V zónách nic neroste: {reason}",
	"ui.parcel.waterYes": "ano",
	"ui.parcel.waterNo": "ne — bez potrubí tu nic nevyroste",
	"ui.notice.zonesWithoutWater": "Zóny nemají vodu, takže v nich nic nevyroste. Postav vodárnu u břehu a natáhni k zónám potrubí (nástroj Potrubí v nabídce Vodovod).",
	"ui.parcel.roadDistance": "{distance} dlaždice, skóre × {factor} %",
	"ui.parcel.roadTooFar": "mimo dosah — tady nic nevyroste",
	"ui.parcel.jobAccess": "Dostupnost práce",
	"ui.parcel.jobAccessFactors": "čtvrť: skóre × {cell} %, město: tempo × {city} %",
	"ui.parcel.nextLevel": "Potřeba na vyšší úroveň",
	"ui.parcel.target": "Cena půdy směřuje k",
	"ui.parcel.term.base": "Základ",
	"ui.parcel.term.prison": "Věznice v okolí",
	"ui.parcel.term.water": "Blízkost vody",
	"ui.parcel.term.congestion": "Kolony",
	"ui.parcel.term.forest": "Les",
	"ui.parcel.term.sand": "Písek",
	"ui.info.emptyParcel": "Prázdná parcela",
	"ui.overlay.coverage.fire": "Dosah hasičů",
	"ui.overlay.coverage.health": "Dosah zdravotnictví",
	"ui.overlay.coverage.education": "Dosah škol",
	"ui.overlay.coverage.parks": "Dosah parků",
	"ui.overlay.power": "Elektřina",
	"ui.overlay.pollution": "Znečištění",
	"ui.overlay.landValue": "Cena půdy",
	"ui.overlay.coverage.culture": "Dosah kultury",
	"ui.overlay.coverage.social": "Dosah sounáležitosti",
	"ui.overlay.title": "Vrstvy",
	"ui.overlay.none": "Žádná vrstva",
	"ui.view.surface": "Pohled na povrch",
	"ui.view.underground": "Pohled pod zem",
	"ui.view.ghost": "Průhledné budovy",
	"ui.overlay.traffic": "Doprava",
	"ui.overlay.happiness": "Spokojenost",
	"ui.overlay.crime": "Kriminalita",
	"ui.overlay.coverage.police": "Dosah policie",
	"ui.overlay.coverage.transit": "Dosah MHD",
	"ui.language.label": "Jazyk",
	"ui.finance.toggle": "Půjčky a dluhopisy",
	"ui.finance.title": "Půjčky a dluhopisy",
	"ui.finance.loans": "Půjčka",
	"ui.finance.bonds": "Dluhopisy",
	"ui.finance.cap": "Strop",
	"ui.finance.rate": "Úrok",
	"ui.finance.amount": "Částka",
	"ui.finance.term": "Doba splácení (měsíce)",
	"ui.finance.coupon": "Kupón (% ročně)",
	"ui.finance.maturity": "Splatnost (roky)",
	"ui.finance.take": "Sjednat",
	"ui.finance.issue": "Vypsat emisi",
	"ui.finance.percent": "{value} %",
	"ui.finance.loanPreview": "Měsíčně {payment}, celkem se vrátí {total} — úrok {interest}.",
	"ui.finance.loanHint": "Zadej částku do {cap} a dobu {min} až {max} měsíců.",
	"ui.finance.tooManyLoans": "Víc než {max} půjčky naráz město nedostane. Počkej, až některou splatí.",
	"ui.finance.noLoans": "Město nemá žádnou půjčku.",
	"ui.finance.loanRow": "{principal} · zbývá {remaining} · měsíčně {payment} · splaceno {paid} z {term}",
	"ui.finance.bondPreview": "Odhad úpisu {share} % — asi {expected}. Poplatek {fee} teď, kupón {coupon} ročně.",
	"ui.finance.bondHint": "Zadej částku do {cap}, kupón do {rate} % a splatnost {min} až {max} let.",
	"ui.finance.bondsBlocked": "Po nesplacené jistině nikdo neupíše. Ještě asi {years} let.",
	"ui.finance.cannotAffordFee": "Na poplatek za vydání ({fee}) město nemá.",
	"ui.finance.noBonds": "Město nevydalo žádné dluhopisy.",
	"ui.finance.bondRow": "Upsáno {subscribed} z {offered} · kupón {rate} % · splatnost za {years} let",
	"ui.finance.bondDefaulted": "NESPLACENO: {subscribed} z {offered} · kupón {rate} %",
	"ui.transit.toggle": "Linky MHD",
	"ui.transit.title": "Linky MHD",
	"ui.transit.create": "Nová linka",
	"ui.transit.mode.bus": "Autobus",
	"ui.transit.mode.tram": "Tramvaj",
	"ui.transit.mode.metro": "Metro",
	"ui.transit.noLines": "Zatím žádná linka. Postav zastávky a založ ji.",
	"ui.transit.lineName": "Linka {id} — {mode}",
	"ui.transit.running": "jede",
	"ui.transit.stopped": "stojí",
	"ui.transit.delete": "Zrušit linku",
	"ui.transit.stops": "Zastávky ({count} z {max})",
	"ui.transit.stopAt": "{order}. {x}, {y}",
	"ui.transit.stopGone": "{order}. zbořeno",
	"ui.transit.removeStop": "Vyhodit z linky",
	"ui.transit.addStop": "Přidat zastávku",
	"ui.transit.picking": "Klikni na zastávku",
	"ui.transit.pickHint": "Klikni na mapě na zastávku, která má patřit lince {id}.",
	"ui.transit.vehicles": "Vozidla",
	"ui.transit.vehicleCount": "{count} · {cost} za kus",
	"ui.transit.fare": "Jízdné",
	"ui.transit.stats": "Veze {transported} z {demand} lidí, kapacita {capacity}. Příjem {income}, údržba {upkeep}.",
	"ui.transit.problem.unknownMode": "Tenhle druh dopravy obsah nezná.",
	"ui.transit.problem.tooFewStops": "Linka potřebuje aspoň {min} zastávky.",
	"ui.transit.problem.tooManyStops": "Víc než {max} zastávek linka mít nemůže.",
	"ui.transit.problem.notAStop": "Jedna z položek linky není zastávka — nejspíš ji zbořila katastrofa.",
	"ui.transit.problem.wrongMode": "Na lince je zastávka jiného druhu dopravy.",
	"ui.transit.problem.duplicateStop": "Jedna zastávka je na lince dvakrát.",
	"ui.disaster.turnOn": "Zapnout katastrofy",
	"ui.disaster.turnOff": "Vypnout katastrofy",
	"ui.disaster.turnedOn": "Katastrofy zapnuty.",
	"ui.disaster.turnedOff": "Katastrofy vypnuty. Ručně spustit jdou dál.",
	"building.gas_power_plant.name": "Plynová elektrárna",
	"building.gas_power_plant.desc": "Levnější na postavení, dražší na provoz. Čadí míň než uhlí.",
	"building.nuclear_power_plant.name": "Jaderná elektrárna",
	"building.nuclear_power_plant.desc": "Uživí celé město a skoro neznečišťuje. Musí stát u vody kvůli chlazení.",
	"building.wind_turbine.name": "Větrná elektrárna",
	"building.wind_turbine.desc": "Jedna dlaždice, málo proudu, žádný komín. Postaví se i mimo silnici.",
	"building.plaza.name": "Náměstíčko",
	"building.plaza.desc": "Dlážděná plocha s lavičkami. Nejlevnější, co zvedne cenu půdy.",
	"building.city_park.name": "Městský park",
	"building.city_park.desc": "Největší park ve městě. Zvedá cenu půdy v širokém okolí.",
	"ui.info.spriteFile": "Obrázek (dočasné)",
	"ui.tool.pan": "Pacička",
	"ui.menu.pan": "Pohyb",
	"ui.view.decor": "Skrýt stromy a kameny"
};
//#endregion
//#region content/vanilla/locale/en.json
var en_default = {
	"building.residential_small.name": "Small House",
	"building.residential_small.desc": "A modest home for a handful of residents.",
	"building.residential_medium.name": "Two-Storey House",
	"building.residential_medium.desc": "A house the neighbourhood grew a floor onto.",
	"building.residential_large.name": "Tenement House",
	"building.residential_large.desc": "The tallest thing that fits on a single lot.",
	"building.residential_row.name": "Terraced Houses",
	"building.residential_row.desc": "Two lots under one roof.",
	"building.residential_terrace.name": "Tall Terrace",
	"building.residential_terrace.desc": "A terrace the neighbourhood grew floors onto.",
	"building.residential_court.name": "Courtyard Block",
	"building.residential_court.desc": "Perimeter housing wrapped around a courtyard.",
	"building.residential_tower.name": "Tower Block",
	"building.residential_tower.desc": "Homes for a whole street on four lots.",
	"building.commercial_small.name": "Corner Shop",
	"building.commercial_small.desc": "A small store serving the neighbourhood.",
	"building.commercial_medium.name": "Department Store",
	"building.commercial_medium.desc": "Several floors of retail on a single lot.",
	"building.commercial_large.name": "Office Building",
	"building.commercial_large.desc": "The tallest thing that fits on a single lot.",
	"building.commercial_row.name": "Shopping Row",
	"building.commercial_row.desc": "A row of shops across two lots.",
	"building.commercial_arcade.name": "Shopping Arcade",
	"building.commercial_arcade.desc": "A covered arcade across two lots.",
	"building.commercial_centre.name": "Shopping Centre",
	"building.commercial_centre.desc": "Retail that pulls in half the city.",
	"building.commercial_tower.name": "Office Tower",
	"building.commercial_tower.desc": "The most jobs that fit on four lots.",
	"building.industrial_small.name": "Workshop",
	"building.industrial_small.desc": "Light industry. Provides jobs, produces some pollution.",
	"building.industrial_medium.name": "Factory",
	"building.industrial_medium.desc": "More work, more smoke.",
	"building.industrial_large.name": "Foundry",
	"building.industrial_large.desc": "The heaviest plant that fits on a single lot.",
	"building.industrial_row.name": "Warehouse",
	"building.industrial_row.desc": "A shed spanning two lots.",
	"building.industrial_yard.name": "Production Hall",
	"building.industrial_yard.desc": "A hall running two shifts.",
	"building.industrial_works.name": "Large Factory",
	"building.industrial_works.desc": "A hundred jobs and smoke you can smell across town.",
	"building.industrial_chemical.name": "Chemical Works",
	"building.industrial_chemical.desc": "The most jobs and by far the most pollution.",
	"building.coal_power_plant.name": "Coal Power Plant",
	"building.coal_power_plant.desc": "Cheap electricity at the cost of heavy pollution.",
	"building.police_small.name": "Police Station",
	"building.police_small.desc": "Cuts crime nearby and lifts land value.",
	"building.fire_station.name": "Fire Station",
	"building.fire_station.desc": "Lifts land value nearby. Fighting fires arrives with disasters.",
	"building.clinic.name": "Clinic",
	"building.clinic.desc": "Lifts land value. Without health care nearby, residents drift away.",
	"building.school.name": "School",
	"building.school.desc": "Lifts land value and unlocks higher commercial and industrial levels.",
	"building.park_small.name": "Park",
	"building.park_small.desc": "Cheap, and all it does is lift land value nearby.",
	"building.transit_depot.name": "Transit Depot",
	"building.transit_depot.desc": "Serves nobody on its own, but no stop can be built without it.",
	"building.transit_stop.name": "Transit Stop",
	"building.water_works.name": "Waterworks",
	"building.water_works.desc": "Draws water from a lake or the sea and pushes it into the pipes.",
	"building.water_treatment.name": "Sewage Works",
	"building.water_treatment.desc": "Treats the city's waste water. Whatever it cannot take ends up in the soil and the river.",
	"building.pump_station.name": "Pumping Station",
	"building.pump_station.desc": "Produces no water of its own, but carries the network further from the waterworks.",
	"building.transit_stop.desc": "People nearby leave the car at home, so the roads carry less traffic.",
	"building.museum.name": "Museum",
	"building.museum.desc": "A collection people travel for. Expensive, but it carries culture further than anything else.",
	"building.theatre.name": "Theatre",
	"building.theatre.desc": "An evening programme for the whole neighbourhood.",
	"building.cinema.name": "Cinema",
	"building.cinema.desc": "Cheap culture for every day.",
	"building.gallery.name": "Gallery",
	"building.gallery.desc": "A small gallery that brightens up a single street.",
	"building.community_centre.name": "Community Centre",
	"building.community_centre.desc": "Where the neighbourhood meets — clubs, meetings, celebrations.",
	"building.retirement_home.name": "Retirement Home",
	"building.retirement_home.desc": "Care for the people who built the city.",
	"building.landfill.name": "Landfill",
	"building.landfill.desc": "Cheap waste disposal at the cost of heavy local pollution.",
	"building.incinerator.name": "Incinerator",
	"building.incinerator.desc": "Expensive, but handles three times the waste and pollutes less.",
	"building.residential_terraces.name": "Terraced housing",
	"building.residential_terraces.desc": "A continuous terrace — more housing on the same footprint.",
	"building.residential_quarter.name": "Residential quarter",
	"building.residential_quarter.desc": "A whole block of flats around an inner courtyard.",
	"building.residential_highrise.name": "High-rise",
	"building.residential_highrise.desc": "Housing stacked instead of spread. Needs a good neighbourhood.",
	"building.residential_estate.name": "Housing estate",
	"building.residential_estate.desc": "A large residential complex — the most people per tile available.",
	"building.residential_spire.name": "Residential tower",
	"building.residential_spire.desc": "A prestige address. Grows only where land is truly expensive.",
	"building.residential_skyline.name": "Skyline",
	"building.residential_skyline.desc": "The peak of residential growth. Needs a top-tier neighbourhood.",
	"building.commercial_gallery.name": "Shopping arcade",
	"building.commercial_gallery.desc": "A covered arcade with shops on both sides.",
	"building.commercial_plaza.name": "Retail plaza",
	"building.commercial_plaza.desc": "A block of shops around a plaza.",
	"building.commercial_offices.name": "Office building",
	"building.commercial_offices.desc": "Offices instead of shops — more jobs, higher demands.",
	"building.commercial_mall.name": "Shopping mall",
	"building.commercial_mall.desc": "A large mall. Pulls traffic from across the city.",
	"building.commercial_highrise.name": "Office tower",
	"building.commercial_highrise.desc": "A tower of offices in the priciest part of town.",
	"building.commercial_downtown.name": "Downtown core",
	"building.commercial_downtown.desc": "The commercial heart. The highest tier there is.",
	"building.industrial_hall.name": "Production hall",
	"building.industrial_hall.desc": "A long hall for series production.",
	"building.industrial_complex.name": "Industrial complex",
	"building.industrial_complex.desc": "Several plants under one management.",
	"building.industrial_foundry.name": "Foundry",
	"building.industrial_foundry.desc": "Heavy industry — many jobs, plenty of dirt.",
	"building.industrial_refinery.name": "Refinery",
	"building.industrial_refinery.desc": "A large chemical plant. Pollutes far and wide.",
	"building.industrial_smelter.name": "Smelter",
	"building.industrial_smelter.desc": "The heaviest plant available.",
	"building.industrial_park.name": "Industrial park",
	"building.industrial_park.desc": "A sprawling site on the city edge.",
	"building.police_large.name": "Police headquarters",
	"building.police_large.desc": "Wider reach and more strength than a station, at a much higher cost.",
	"building.fire_station_large.name": "Large fire station",
	"building.fire_station_large.desc": "Covers districts a small station cannot reach.",
	"building.hospital.name": "Hospital",
	"building.hospital.desc": "Without health care people drift away; a hospital covers a whole city.",
	"building.high_school.name": "High school",
	"building.high_school.desc": "Higher education opens the way to better shops and plants.",
	"building.university.name": "University",
	"building.university.desc": "The highest education in the city. Expensive, but the top tier needs it.",
	"building.park_large.name": "Large park",
	"building.park_large.desc": "Lifts land value over a wide area and costs almost nothing.",
	"building.prison.name": "Prison",
	"building.prison.desc": "Cuts crime across the city — and land value everywhere in sight of it.",
	"ui.tool.road": "Road",
	"ui.tool.road.street": "Street",
	"ui.tool.road.avenue": "Avenue",
	"ui.tool.road.highway": "Highway",
	"ui.tool.pipe": "Pipes",
	"ui.tool.zone.clear": "Clear zoning",
	"ui.tool.bulldoze": "Bulldoze",
	"ui.tool.terrain.raise": "Raise ground",
	"ui.tool.terrain.lower": "Lower ground",
	"ui.tool.terrain.level": "Level ground",
	"ui.tool.terrain.fill": "Fill slope",
	"ui.tool.zone.residential": "Residential zone",
	"ui.tool.zone.commercial": "Commercial zone",
	"ui.tool.zone.industrial": "Industrial zone",
	"ui.menu.road": "Roads",
	"ui.menu.terrain": "Terrain",
	"ui.menu.zone": "Zones",
	"ui.menu.power": "Power",
	"ui.menu.water": "Water",
	"ui.menu.waste": "Waste",
	"ui.menu.police": "Police",
	"ui.menu.fire": "Fire",
	"ui.menu.health": "Health",
	"ui.menu.education": "Education",
	"ui.menu.parks": "Parks",
	"ui.menu.culture": "Culture",
	"ui.menu.social": "Community",
	"ui.menu.transit": "Transit",
	"ui.menu.utility": "Utilities",
	"ui.menu.service": "Services",
	"ui.newGame.title": "New city",
	"ui.newGame.cityName": "City name",
	"ui.newGame.defaultCityName": "Newbridge",
	"ui.newGame.seed": "Map seed",
	"ui.newGame.size": "Map size",
	"ui.newGame.size.heavy": "The largest map is sixteen times the default — it may stutter on a weaker machine.",
	"ui.newGame.disasters": "Disasters",
	"ui.alert.title": "{name}!",
	"ui.alert.show": "Show me",
	"ui.alert.ignore": "Ignore",
	"ui.alert.body.fire": "The city is on fire. Flames spread to neighbouring tiles and only a road, water or a bulldozed firebreak will stop them. Fire brigades help only where they reach.",
	"ui.alert.body.wildfire": "The forest is burning. There is time to cut a break before the fire reaches the buildings — after that it is too late.",
	"ui.alert.body.flood": "Water is rising and flooding the lowland. Flooded buildings decay until it recedes. A raised bank holds it back.",
	"ui.alert.body.tornado": "A tornado is crossing the city, taking whatever stands in its way. It cannot be stopped, only cleaned up after.",
	"ui.alert.body.earthquake": "An earthquake. Buildings collapse or drop a level, roads and pipes crack. Tall blocks take it better than low ones.",
	"ui.alert.body.explosion": "An explosion. The surroundings are flattened and burning.",
	"ui.alert.body.industrialAccident": "An industrial accident. Blast and fire have hit the surrounding area.",
	"ui.alert.body.pileup": "A pile-up is blocking the road. Traffic around it is stuck until it is cleared.",
	"ui.alert.body.strike": "A strike in the district. Services there are down and happiness falls until conditions improve. An unresolved strike can grow into a riot.",
	"ui.alert.body.riot": "Civil unrest. The district is out of control, land value is falling and the police have their hands full.",
	"ui.alert.body.gangWar": "A gang war. Nothing is destroyed, but the district gets permanently worse — crime up, land value down.",
	"ui.alert.body.blackout": "A blackout. Power plants have dropped out and without power the services are down too, so the risk of everything else has jumped.",
	"ui.alert.body.epidemic": "An epidemic. Disease is spreading among the residents and people are dying. Only enough health coverage will stop it.",
	"ui.alert.body.chemicalSpill": "A chemical spill. The waterworks is out and the surroundings stay poisoned even after the leak ends.",
	"ui.alert.body.landslide": "A landslide. The slope gave way and took what stood on it.",
	"ui.disaster.title": "Disasters",
	"ui.disaster.armed": "{name}: click the map where it should strike.",
	"ui.disaster.started": "Started: {name}.",
	"ui.disaster.fire": "Fire",
	"ui.disaster.flood": "Flood",
	"ui.disaster.tornado": "Tornado",
	"ui.disaster.earthquake": "Earthquake",
	"ui.disaster.pileup": "Pile-up",
	"ui.disaster.strike": "Strike",
	"ui.disaster.riot": "Civil unrest",
	"ui.disaster.industrialAccident": "Industrial accident",
	"ui.disaster.gangWar": "Gang war",
	"ui.disaster.blackout": "Blackout",
	"ui.disaster.epidemic": "Epidemic",
	"ui.disaster.chemicalSpill": "Chemical spill",
	"ui.disaster.explosion": "Explosion",
	"ui.disaster.wildfire": "Wildfire",
	"ui.disaster.landslide": "Landslide",
	"ui.newGame.reroll": "Another map",
	"ui.newGame.start": "Found the city",
	"ui.newGame.resume": "Continue",
	"ui.newGame.stats": "Land {land} %, generated in {ms} ms.",
	"ui.hud.funds": "Funds",
	"ui.hud.population": "Population",
	"ui.hud.happiness": "Happiness",
	"ui.hud.jobs": "Jobs",
	"ui.hud.balance": "Monthly balance",
	"ui.hud.dateLabel": "Date",
	"ui.hud.date": "Year {year}, month {month}, day {day}",
	"ui.hud.demand": "Demand",
	"ui.hud.powered": "Powered",
	"ui.hud.power": "Power",
	"ui.notice.powerShortage": "Not enough power: you produce {produced}, the city needs {needed}. Build another plant.",
	"ui.demand.residential": "R",
	"ui.demand.commercial": "C",
	"ui.demand.industrial": "I",
	"ui.speed.label": "Speed",
	"ui.speed.pause": "Pause",
	"ui.speed.value": "{speed}×",
	"ui.funding.title": "Service funding",
	"ui.service.police": "Police",
	"ui.service.fire": "Fire",
	"ui.service.health": "Health",
	"ui.service.education": "Education",
	"ui.service.parks": "Parks",
	"ui.service.transit": "Transit",
	"ui.service.culture": "Culture",
	"ui.service.social": "Community",
	"ui.tax.title": "Tax rates",
	"ui.tax.decrease": "Lower the tax rate",
	"ui.tax.increase": "Raise the tax rate",
	"ui.save.title": "Save",
	"ui.save.quicksave": "Quick save",
	"ui.save.quickload": "Quick load",
	"ui.save.download": "Save to file",
	"ui.save.open": "Load from file",
	"ui.save.saved": "Saved ({size} kB)",
	"ui.save.loaded": "Loaded",
	"ui.save.storeFailed": "Saving failed — browser storage is full or disabled.",
	"ui.save.empty": "Nothing saved yet",
	"ui.save.failed": "Save could not be read: {reason}",
	"ui.save.noWaterNetwork": "The loaded city has no water network: {count} buildings will decay without water. Build a water works and pipes.",
	"ui.notice.bankrupt": "The treasury is in the red — nothing new will be built until it is back at zero. Demolish what you do not need, or raise taxes.",
	"ui.save.missingContent": "Missing content: {list}",
	"ui.cost.spent": "−{amount}",
	"ui.price.withLevelling": "{total} ({levelling} of it for levelling)",
	"ui.budget.toggle": "Economy",
	"ui.budget.title": "Economy overview",
	"ui.budget.building": "Building",
	"ui.budget.cost": "Cost",
	"ui.budget.count": "Count",
	"ui.budget.powered": "Powered",
	"ui.budget.income": "Income",
	"ui.budget.upkeep": "Upkeep",
	"ui.budget.net": "Net",
	"ui.budget.transit": "Transit",
	"ui.budget.debt": "Loan payments",
	"grant.first_thousand.name": "Grant: first thousand",
	"grant.first_thousand.desc": "For reaching a thousand residents. The region chipped in.",
	"grant.ten_thousand.name": "Grant: ten thousand strong",
	"grant.ten_thousand.desc": "For ten thousand residents. The state noticed something growing here.",
	"grant.university.name": "Grant: university",
	"grant.university.desc": "For the city’s first university.",
	"grant.content_city.name": "Grant: contented city",
	"grant.content_city.desc": "For a full year of high happiness without a break.",
	"error.noFinanceRules": "Finance rules are not loaded.",
	"error.invalidAmount": "Invalid amount.",
	"error.invalidTerm": "The term must be {min} to {max} months.",
	"error.tooManyLoans": "No more than {max} loans at once.",
	"error.overLoanCap": "Over the cap. You can borrow at most {cap}.",
	"ui.budget.bonds": "Bonds",
	"error.bondsBlocked": "After a default the market is closed until tick {until}.",
	"error.overBondCap": "Over the cap. You can offer at most {cap}.",
	"error.invalidRate": "The rate must be 0 to {max} percent.",
	"error.invalidMaturity": "Maturity must be {min} to {max} ticks.",
	"error.cannotAffordFee": "The city cannot afford the issue fee ({fee}).",
	"ui.budget.roads": "Roads",
	"ui.budget.total": "Monthly total",
	"ui.budget.funds": "Funds: {funds}. An unpowered building earns nothing and costs nothing.",
	"ui.budget.unit.population": "residents",
	"ui.budget.unit.jobs": "jobs",
	"ui.budget.formula.tax": "tax: {base} {unit} × {value} × {rate} % = {income}",
	"ui.budget.formula.upkeep": "upkeep: {count} × {each} = {total}",
	"ui.budget.formula.idle": "{count} idle (no power)",
	"ui.info.position": "Position",
	"ui.info.footprint": "Footprint",
	"ui.info.level": "Level",
	"ui.info.built": "Built",
	"ui.info.cost": "Construction cost",
	"ui.info.powerProduction": "Power production",
	"ui.info.powerConsumption": "Power consumption",
	"ui.info.powered": "Connected",
	"ui.info.poweredYes": "yes",
	"ui.info.poweredNo": "no",
	"ui.info.monthlyIncome": "Monthly tax",
	"ui.info.monthlyUpkeep": "Monthly upkeep",
	"ui.info.monthlyNet": "Monthly net",
	"ui.info.pollution": "Pollution",
	"ui.info.requirements": "Requirements",
	"ui.info.unknownDefinition": "No loaded content describes this building — a mod is probably missing.",
	"ui.info.abandonedWarning": "This building is abandoned. It earns nothing, costs nothing and drags the area down — it will not go away on its own, you have to bulldoze it.",
	"ui.info.noPowerWarning": "Without power the building is idle: it earns nothing and costs nothing.",
	"ui.info.dryRelayWarning": "Water never reaches this pump station, so it extends nothing. A station is not a source — it must stand on a pipe the water already reached.",
	"error.outOfBounds": "Outside the map.",
	"error.water": "You cannot build on water.",
	"error.roadDowngrade": "A road cannot be downgraded. Bulldoze it and build again.",
	"error.roadExists": "There is already a road here.",
	"error.roadInTheWay": "A road is in the way.",
	"error.rubbleInTheWay": "Rubble is in the way — clear it with the bulldozer first.",
	"error.occupied": "The tile is occupied.",
	"error.occupiedFootprint": "It does not fit here. This building needs {width} × {depth} free tiles.",
	"error.nothingToBulldoze": "Nothing to bulldoze here.",
	"error.needsWater": "Nothing builds here without water. Bring a pipe over.",
	"error.needsShore": "A waterworks has to stand by the water.",
	"error.noPipe": "There is no pipe here.",
	"error.pipeExists": "There is already a pipe here.",
	"error.pipeOnWater": "Pipes do not hold on water.",
	"error.terraformWater": "Raising the sea floor is beyond us.",
	"error.terraformNoChange": "The ground is already exactly like this.",
	"error.notFlat": "Nothing builds on a slope. Level the plot first.",
	"error.bridgeNeedsBank": "A bridge has to start on a bank, not mid-water.",
	"error.needsRoad": "It must touch a road.",
	"error.needsPower": "It needs a power connection.",
	"error.requiresService": "{service} does not reach here — needs coverage of at least {needed}.",
	"error.requiresBuilding": "The city needs a {id} first.",
	"error.terrainNotAllowed": "This terrain does not allow that building.",
	"error.wrongZone": "The whole footprint must sit in the same zone.",
	"building.tram_stop.name": "Tram stop",
	"building.tram_stop.desc": "A stop on a tram line. Tracks share the roadway and take capacity from it.",
	"building.metro_station.name": "Metro station",
	"building.metro_station.desc": "A metro station. No load on roads at all, but the priciest option.",
	"error.unknownTransitMode": "Unknown transit mode: {mode}.",
	"error.unknownLine": "No such line.",
	"error.notAStop": "That building is not a stop.",
	"error.wrongStopMode": "The stop is for {mode}, the line runs {expected}.",
	"error.stopAlreadyOnLine": "The stop is already on the line.",
	"error.stopNotOnLine": "The stop is not on the line.",
	"error.tooManyStops": "A line takes at most {max} stops.",
	"error.invalidVehicles": "Invalid number of vehicles.",
	"error.invalidFare": "Invalid fare.",
	"error.notEnoughFunds": "Not enough money: it costs {cost}, you have {funds}.",
	"error.unknownDefinition": "Unknown definition {id}.",
	"error.zoneNoChange": "A zone cannot be marked here.",
	"error.notAZone": "That is not a zone.",
	"error.invalidFunding": "Invalid funding level.",
	"error.unknownSpeed": "Unknown speed {speed}.",
	"error.crash": "Runtime error: {message}",
	"ui.parcel.title": "Parcel breakdown",
	"ui.parcel.road": "Road",
	"ui.parcel.water": "Water",
	"ui.parcel.surface": "Surface",
	"ui.terrain.grass": "Grass",
	"ui.terrain.water": "Water",
	"ui.terrain.sand": "Sand",
	"ui.terrain.rock": "Rock",
	"ui.terrain.forest": "Forest",
	"ui.terrain.marsh": "Marsh",
	"ui.parcel.blocked.noZone": "Nothing is built here without a zone.",
	"ui.parcel.blocked.bankrupt": "The treasury is in the red — nothing grows until it is back at zero.",
	"ui.parcel.blocked.noDemand": "There is no demand for this zone right now.",
	"ui.parcel.blocked.zoneTooSmall": "The zone is shallower than anything that fits. Widen it to the building depth.",
	"ui.parcel.blocked.tooFarFromRoad": "Too far from a road.",
	"ui.parcel.blocked.noDefinition": "There is nothing to build for this zone.",
	"ui.notice.nothingGrows": "Nothing grows in the zones: {reason}",
	"ui.parcel.waterYes": "yes",
	"ui.parcel.waterNo": "no — nothing grows without pipes",
	"ui.notice.zonesWithoutWater": "The zones have no water, so nothing will grow there. Build a water works on the shore and run pipes to the zones (the Pipe tool in the Water menu).",
	"ui.parcel.roadDistance": "{distance} tiles, score × {factor} %",
	"ui.parcel.roadTooFar": "out of reach — nothing grows here",
	"ui.parcel.jobAccess": "Access to jobs",
	"ui.parcel.jobAccessFactors": "district: score × {cell} %, city: pace × {city} %",
	"ui.parcel.nextLevel": "Needed for the next level",
	"ui.parcel.target": "Land value heading for",
	"ui.parcel.term.base": "Base",
	"ui.parcel.term.prison": "Prison nearby",
	"ui.parcel.term.water": "Near water",
	"ui.parcel.term.congestion": "Congestion",
	"ui.parcel.term.forest": "Forest",
	"ui.parcel.term.sand": "Sand",
	"ui.info.emptyParcel": "Empty parcel",
	"ui.overlay.coverage.fire": "Fire cover",
	"ui.overlay.coverage.health": "Health cover",
	"ui.overlay.coverage.education": "School cover",
	"ui.overlay.coverage.parks": "Park cover",
	"ui.overlay.power": "Power",
	"ui.overlay.pollution": "Pollution",
	"ui.overlay.landValue": "Land value",
	"ui.overlay.coverage.culture": "Culture reach",
	"ui.overlay.coverage.social": "Community reach",
	"ui.overlay.title": "Layers",
	"ui.overlay.none": "No layer",
	"ui.view.surface": "Surface view",
	"ui.view.underground": "Underground view",
	"ui.view.ghost": "See-through buildings",
	"ui.overlay.traffic": "Traffic",
	"ui.overlay.happiness": "Happiness",
	"ui.overlay.crime": "Crime",
	"ui.overlay.coverage.police": "Police reach",
	"ui.overlay.coverage.transit": "Transit reach",
	"ui.language.label": "Language",
	"ui.finance.toggle": "Loans and bonds",
	"ui.finance.title": "Loans and bonds",
	"ui.finance.loans": "Loan",
	"ui.finance.bonds": "Bonds",
	"ui.finance.cap": "Cap",
	"ui.finance.rate": "Interest",
	"ui.finance.amount": "Amount",
	"ui.finance.term": "Term (months)",
	"ui.finance.coupon": "Coupon (% per year)",
	"ui.finance.maturity": "Maturity (years)",
	"ui.finance.take": "Take out",
	"ui.finance.issue": "Issue",
	"ui.finance.percent": "{value} %",
	"ui.finance.loanPreview": "{payment} a month, {total} repaid in total — {interest} of interest.",
	"ui.finance.loanHint": "Enter an amount up to {cap} and a term of {min} to {max} months.",
	"ui.finance.tooManyLoans": "The city cannot hold more than {max} loans at once. Wait until one is repaid.",
	"ui.finance.noLoans": "The city has no loans.",
	"ui.finance.loanRow": "{principal} · {remaining} left · {payment} a month · {paid} of {term} paid",
	"ui.finance.bondPreview": "Expected uptake {share} % — about {expected}. Fee {fee} now, coupon {coupon} a year.",
	"ui.finance.bondHint": "Enter an amount up to {cap}, a coupon up to {rate} % and a maturity of {min} to {max} years.",
	"ui.finance.bondsBlocked": "After a default nobody will subscribe. About {years} years to go.",
	"ui.finance.cannotAffordFee": "The city cannot afford the issue fee ({fee}).",
	"ui.finance.noBonds": "The city has issued no bonds.",
	"ui.finance.bondRow": "{subscribed} of {offered} subscribed · coupon {rate} % · matures in {years} years",
	"ui.finance.bondDefaulted": "DEFAULTED: {subscribed} of {offered} · coupon {rate} %",
	"ui.transit.toggle": "Transit lines",
	"ui.transit.title": "Transit lines",
	"ui.transit.create": "New line",
	"ui.transit.mode.bus": "Bus",
	"ui.transit.mode.tram": "Tram",
	"ui.transit.mode.metro": "Metro",
	"ui.transit.noLines": "No lines yet. Build stops and start one.",
	"ui.transit.lineName": "Line {id} — {mode}",
	"ui.transit.running": "running",
	"ui.transit.stopped": "idle",
	"ui.transit.delete": "Delete line",
	"ui.transit.stops": "Stops ({count} of {max})",
	"ui.transit.stopAt": "{order}. {x}, {y}",
	"ui.transit.stopGone": "{order}. destroyed",
	"ui.transit.removeStop": "Drop from line",
	"ui.transit.addStop": "Add stop",
	"ui.transit.picking": "Click a stop",
	"ui.transit.pickHint": "Click a stop on the map to add it to line {id}.",
	"ui.transit.vehicles": "Vehicles",
	"ui.transit.vehicleCount": "{count} · {cost} each",
	"ui.transit.fare": "Fare",
	"ui.transit.stats": "Carries {transported} of {demand} people, capacity {capacity}. Income {income}, upkeep {upkeep}.",
	"ui.transit.problem.unknownMode": "The content does not know this transit mode.",
	"ui.transit.problem.tooFewStops": "A line needs at least {min} stops.",
	"ui.transit.problem.tooManyStops": "A line cannot have more than {max} stops.",
	"ui.transit.problem.notAStop": "One entry on the line is not a stop — a disaster probably destroyed it.",
	"ui.transit.problem.wrongMode": "There is a stop of another transit mode on the line.",
	"ui.transit.problem.duplicateStop": "One stop is on the line twice.",
	"ui.disaster.turnOn": "Turn disasters on",
	"ui.disaster.turnOff": "Turn disasters off",
	"ui.disaster.turnedOn": "Disasters on.",
	"ui.disaster.turnedOff": "Disasters off. Triggering them by hand still works.",
	"building.gas_power_plant.name": "Gas power plant",
	"building.gas_power_plant.desc": "Cheaper to build, dearer to run. Smokes less than coal.",
	"building.nuclear_power_plant.name": "Nuclear power plant",
	"building.nuclear_power_plant.desc": "Feeds the whole city and barely pollutes. Must stand by water for cooling.",
	"building.wind_turbine.name": "Wind turbine",
	"building.wind_turbine.desc": "One tile, little power, no chimney. Needs no road.",
	"building.plaza.name": "Paved square",
	"building.plaza.desc": "Paving and benches. The cheapest thing that lifts land value.",
	"building.city_park.name": "City park",
	"building.city_park.desc": "The largest park in town. Lifts land value over a wide area.",
	"ui.info.spriteFile": "Sprite file (temporary)",
	"ui.tool.pan": "Hand",
	"ui.menu.pan": "Move",
	"ui.view.decor": "Hide trees and rocks"
};
var manifest_default = {
	id: "vanilla",
	name: "Base Game",
	version: "0.1.0",
	gameVersion: ">=0.1.0",
	dependencies: []
};
var sprites_default = {
	formatVersion: 1,
	scale: 4,
	sprites: [
		{
			"building": "boulders",
			"variant": "a",
			"file": "boulders__a.png",
			"width": 115,
			"height": 116,
			"anchor": [57, 116]
		},
		{
			"building": "boulders",
			"variant": "b",
			"file": "boulders__b.png",
			"width": 115,
			"height": 95,
			"anchor": [57, 95]
		},
		{
			"building": "boulders",
			"variant": "c",
			"file": "boulders__c.png",
			"width": 115,
			"height": 115,
			"anchor": [57, 115]
		},
		{
			"building": "vanilla:cinema",
			"variant": "a",
			"file": "cinema__a.png",
			"width": 512,
			"height": 315,
			"anchor": [245, 315]
		},
		{
			"building": "vanilla:cinema",
			"variant": "b",
			"file": "cinema__b.png",
			"width": 512,
			"height": 313,
			"anchor": [257, 313]
		},
		{
			"building": "vanilla:cinema",
			"variant": "c",
			"file": "cinema__c.png",
			"width": 512,
			"height": 332,
			"anchor": [237, 332]
		},
		{
			"building": "vanilla:city_park",
			"variant": "a",
			"file": "city_park__a.png",
			"width": 768,
			"height": 452,
			"anchor": [377, 452]
		},
		{
			"building": "vanilla:city_park",
			"variant": "b",
			"file": "city_park__b.png",
			"width": 768,
			"height": 441,
			"anchor": [381, 441]
		},
		{
			"building": "vanilla:city_park",
			"variant": "c",
			"file": "city_park__c.png",
			"width": 768,
			"height": 416,
			"anchor": [383, 416]
		},
		{
			"building": "vanilla:clinic",
			"variant": "a",
			"file": "clinic__a.png",
			"width": 512,
			"height": 300,
			"anchor": [255, 300]
		},
		{
			"building": "vanilla:clinic",
			"variant": "b",
			"file": "clinic__b.png",
			"width": 512,
			"height": 293,
			"anchor": [259, 293]
		},
		{
			"building": "vanilla:clinic",
			"variant": "c",
			"file": "clinic__c.png",
			"width": 512,
			"height": 274,
			"anchor": [274, 274]
		},
		{
			"building": "vanilla:coal_power_plant",
			"variant": "a",
			"file": "coal_power_plant__a.png",
			"width": 1280,
			"height": 808,
			"anchor": [594, 808]
		},
		{
			"building": "vanilla:coal_power_plant",
			"variant": "b",
			"file": "coal_power_plant__b.png",
			"width": 1280,
			"height": 900,
			"anchor": [617, 900]
		},
		{
			"building": "vanilla:coal_power_plant",
			"variant": "c",
			"file": "coal_power_plant__c.png",
			"width": 1280,
			"height": 708,
			"anchor": [603, 708]
		},
		{
			"building": "vanilla:commercial_arcade",
			"variant": "a",
			"file": "commercial_arcade__a.png",
			"width": 384,
			"height": 266,
			"anchor": [241, 266]
		},
		{
			"building": "vanilla:commercial_arcade",
			"variant": "b",
			"file": "commercial_arcade__b.png",
			"width": 384,
			"height": 251,
			"anchor": [256, 251]
		},
		{
			"building": "vanilla:commercial_arcade",
			"variant": "c",
			"file": "commercial_arcade__c.png",
			"width": 384,
			"height": 218,
			"anchor": [253, 218]
		},
		{
			"building": "vanilla:commercial_centre",
			"variant": "a",
			"file": "commercial_centre__a.png",
			"width": 512,
			"height": 385,
			"anchor": [255, 385]
		},
		{
			"building": "vanilla:commercial_centre",
			"variant": "b",
			"file": "commercial_centre__b.png",
			"width": 512,
			"height": 483,
			"anchor": [256, 483]
		},
		{
			"building": "vanilla:commercial_centre",
			"variant": "c",
			"file": "commercial_centre__c.png",
			"width": 512,
			"height": 395,
			"anchor": [252, 395]
		},
		{
			"building": "vanilla:commercial_downtown",
			"variant": "a",
			"file": "commercial_downtown__a.png",
			"width": 768,
			"height": 660,
			"anchor": [381, 660]
		},
		{
			"building": "vanilla:commercial_downtown",
			"variant": "b",
			"file": "commercial_downtown__b.png",
			"width": 768,
			"height": 601,
			"anchor": [378, 601]
		},
		{
			"building": "vanilla:commercial_downtown",
			"variant": "c",
			"file": "commercial_downtown__c.png",
			"width": 768,
			"height": 626,
			"anchor": [384, 626]
		},
		{
			"building": "vanilla:commercial_gallery",
			"variant": "a",
			"file": "commercial_gallery__a.png",
			"width": 640,
			"height": 363,
			"anchor": [414, 363]
		},
		{
			"building": "vanilla:commercial_gallery",
			"variant": "b",
			"file": "commercial_gallery__b.png",
			"width": 640,
			"height": 387,
			"anchor": [384, 387]
		},
		{
			"building": "vanilla:commercial_gallery",
			"variant": "c",
			"file": "commercial_gallery__c.png",
			"width": 640,
			"height": 736,
			"anchor": [384, 736]
		},
		{
			"building": "vanilla:commercial_highrise",
			"variant": "a",
			"file": "commercial_highrise__a.png",
			"width": 512,
			"height": 544,
			"anchor": [253, 544]
		},
		{
			"building": "vanilla:commercial_highrise",
			"variant": "b",
			"file": "commercial_highrise__b.png",
			"width": 512,
			"height": 446,
			"anchor": [254, 446]
		},
		{
			"building": "vanilla:commercial_highrise",
			"variant": "c",
			"file": "commercial_highrise__c.png",
			"width": 512,
			"height": 447,
			"anchor": [252, 447]
		},
		{
			"building": "vanilla:commercial_large",
			"variant": "a",
			"file": "commercial_large__a.png",
			"width": 256,
			"height": 165,
			"anchor": [124, 165]
		},
		{
			"building": "vanilla:commercial_large",
			"variant": "b",
			"file": "commercial_large__b.png",
			"width": 256,
			"height": 169,
			"anchor": [126, 169]
		},
		{
			"building": "vanilla:commercial_large",
			"variant": "c",
			"file": "commercial_large__c.png",
			"width": 256,
			"height": 186,
			"anchor": [127, 186]
		},
		{
			"building": "vanilla:commercial_mall",
			"variant": "a",
			"file": "commercial_mall__a.png",
			"width": 768,
			"height": 544,
			"anchor": [384, 544]
		},
		{
			"building": "vanilla:commercial_mall",
			"variant": "b",
			"file": "commercial_mall__b.png",
			"width": 768,
			"height": 538,
			"anchor": [381, 538]
		},
		{
			"building": "vanilla:commercial_mall",
			"variant": "c",
			"file": "commercial_mall__c.png",
			"width": 768,
			"height": 565,
			"anchor": [390, 565]
		},
		{
			"building": "vanilla:commercial_medium",
			"variant": "a",
			"file": "commercial_medium__a.png",
			"width": 256,
			"height": 175,
			"anchor": [132, 175]
		},
		{
			"building": "vanilla:commercial_medium",
			"variant": "b",
			"file": "commercial_medium__b.png",
			"width": 256,
			"height": 181,
			"anchor": [123, 181]
		},
		{
			"building": "vanilla:commercial_medium",
			"variant": "c",
			"file": "commercial_medium__c.png",
			"width": 256,
			"height": 165,
			"anchor": [126, 165]
		},
		{
			"building": "vanilla:commercial_offices",
			"variant": "a",
			"file": "commercial_offices__a.png",
			"width": 512,
			"height": 415,
			"anchor": [254, 415]
		},
		{
			"building": "vanilla:commercial_offices",
			"variant": "b",
			"file": "commercial_offices__b.png",
			"width": 512,
			"height": 376,
			"anchor": [258, 376]
		},
		{
			"building": "vanilla:commercial_offices",
			"variant": "c",
			"file": "commercial_offices__c.png",
			"width": 512,
			"height": 406,
			"anchor": [255, 406]
		},
		{
			"building": "vanilla:commercial_plaza",
			"variant": "a",
			"file": "commercial_plaza__a.png",
			"width": 768,
			"height": 551,
			"anchor": [374, 551]
		},
		{
			"building": "vanilla:commercial_plaza",
			"variant": "b",
			"file": "commercial_plaza__b.png",
			"width": 768,
			"height": 573,
			"anchor": [385, 573]
		},
		{
			"building": "vanilla:commercial_plaza",
			"variant": "c",
			"file": "commercial_plaza__c.png",
			"width": 768,
			"height": 532,
			"anchor": [371, 532]
		},
		{
			"building": "vanilla:commercial_row",
			"variant": "a",
			"file": "commercial_row__a.png",
			"width": 384,
			"height": 221,
			"anchor": [243, 221]
		},
		{
			"building": "vanilla:commercial_row",
			"variant": "b",
			"file": "commercial_row__b.png",
			"width": 384,
			"height": 202,
			"anchor": [256, 202]
		},
		{
			"building": "vanilla:commercial_row",
			"variant": "c",
			"file": "commercial_row__c.png",
			"width": 384,
			"height": 207,
			"anchor": [256, 207]
		},
		{
			"building": "vanilla:commercial_small",
			"variant": "a",
			"file": "commercial_small__a.png",
			"width": 256,
			"height": 183,
			"anchor": [128, 183]
		},
		{
			"building": "vanilla:commercial_small",
			"variant": "b",
			"file": "commercial_small__b.png",
			"width": 256,
			"height": 170,
			"anchor": [126, 170]
		},
		{
			"building": "vanilla:commercial_small",
			"variant": "c",
			"file": "commercial_small__c.png",
			"width": 256,
			"height": 172,
			"anchor": [124, 172]
		},
		{
			"building": "vanilla:commercial_tower",
			"variant": "a",
			"file": "commercial_tower__a.png",
			"width": 512,
			"height": 431,
			"anchor": [265, 431]
		},
		{
			"building": "vanilla:commercial_tower",
			"variant": "b",
			"file": "commercial_tower__b.png",
			"width": 512,
			"height": 353,
			"anchor": [227, 353]
		},
		{
			"building": "vanilla:commercial_tower",
			"variant": "c",
			"file": "commercial_tower__c.png",
			"width": 512,
			"height": 456,
			"anchor": [244, 456]
		},
		{
			"building": "vanilla:community_centre",
			"variant": "a",
			"file": "community_centre__a.png",
			"width": 512,
			"height": 258,
			"anchor": [255, 258]
		},
		{
			"building": "vanilla:community_centre",
			"variant": "b",
			"file": "community_centre__b.png",
			"width": 512,
			"height": 357,
			"anchor": [243, 357]
		},
		{
			"building": "vanilla:community_centre",
			"variant": "c",
			"file": "community_centre__c.png",
			"width": 512,
			"height": 307,
			"anchor": [259, 307]
		},
		{
			"building": "vanilla:fire_station",
			"variant": "a",
			"file": "fire_station__a.png",
			"width": 512,
			"height": 331,
			"anchor": [252, 331]
		},
		{
			"building": "vanilla:fire_station",
			"variant": "b",
			"file": "fire_station__b.png",
			"width": 512,
			"height": 413,
			"anchor": [255, 413]
		},
		{
			"building": "vanilla:fire_station",
			"variant": "c",
			"file": "fire_station__c.png",
			"width": 512,
			"height": 319,
			"anchor": [254, 319]
		},
		{
			"building": "vanilla:fire_station_large",
			"variant": "a",
			"file": "fire_station_large__a.png",
			"width": 512,
			"height": 271,
			"anchor": [251, 271]
		},
		{
			"building": "vanilla:fire_station_large",
			"variant": "b",
			"file": "fire_station_large__b.png",
			"width": 512,
			"height": 278,
			"anchor": [255, 278]
		},
		{
			"building": "vanilla:fire_station_large",
			"variant": "c",
			"file": "fire_station_large__c.png",
			"width": 512,
			"height": 311,
			"anchor": [255, 311]
		},
		{
			"building": "forest_clump",
			"variant": "a",
			"file": "forest_clump__a.png",
			"width": 256,
			"height": 258,
			"anchor": [128, 258]
		},
		{
			"building": "forest_clump",
			"variant": "b",
			"file": "forest_clump__b.png",
			"width": 256,
			"height": 294,
			"anchor": [128, 294]
		},
		{
			"building": "forest_clump",
			"variant": "c",
			"file": "forest_clump__c.png",
			"width": 256,
			"height": 382,
			"anchor": [128, 382]
		},
		{
			"building": "vanilla:gallery",
			"variant": "a",
			"file": "gallery__a.png",
			"width": 256,
			"height": 162,
			"anchor": [127, 162]
		},
		{
			"building": "vanilla:gallery",
			"variant": "b",
			"file": "gallery__b.png",
			"width": 256,
			"height": 157,
			"anchor": [133, 157]
		},
		{
			"building": "vanilla:gallery",
			"variant": "c",
			"file": "gallery__c.png",
			"width": 256,
			"height": 163,
			"anchor": [125, 163]
		},
		{
			"building": "vanilla:gas_power_plant",
			"variant": "a",
			"file": "gas_power_plant__a.png",
			"width": 768,
			"height": 511,
			"anchor": [384, 511]
		},
		{
			"building": "vanilla:gas_power_plant",
			"variant": "b",
			"file": "gas_power_plant__b.png",
			"width": 768,
			"height": 469,
			"anchor": [378, 469]
		},
		{
			"building": "vanilla:gas_power_plant",
			"variant": "c",
			"file": "gas_power_plant__c.png",
			"width": 768,
			"height": 549,
			"anchor": [375, 549]
		},
		{
			"building": "vanilla:high_school",
			"variant": "a",
			"file": "high_school__a.png",
			"width": 512,
			"height": 300,
			"anchor": [279, 300]
		},
		{
			"building": "vanilla:high_school",
			"variant": "b",
			"file": "high_school__b.png",
			"width": 512,
			"height": 317,
			"anchor": [257, 317]
		},
		{
			"building": "vanilla:high_school",
			"variant": "c",
			"file": "high_school__c.png",
			"width": 512,
			"height": 276,
			"anchor": [255, 276]
		},
		{
			"building": "vanilla:hospital",
			"variant": "a",
			"file": "hospital__a.png",
			"width": 768,
			"height": 480,
			"anchor": [381, 480]
		},
		{
			"building": "vanilla:hospital",
			"variant": "b",
			"file": "hospital__b.png",
			"width": 768,
			"height": 414,
			"anchor": [370, 414]
		},
		{
			"building": "vanilla:hospital",
			"variant": "c",
			"file": "hospital__c.png",
			"width": 768,
			"height": 568,
			"anchor": [384, 568]
		},
		{
			"building": "vanilla:incinerator",
			"variant": "a",
			"file": "incinerator__a.png",
			"width": 768,
			"height": 601,
			"anchor": [376, 601]
		},
		{
			"building": "vanilla:incinerator",
			"variant": "b",
			"file": "incinerator__b.png",
			"width": 768,
			"height": 688,
			"anchor": [360, 688]
		},
		{
			"building": "vanilla:incinerator",
			"variant": "c",
			"file": "incinerator__c.png",
			"width": 768,
			"height": 527,
			"anchor": [385, 527]
		},
		{
			"building": "vanilla:industrial_chemical",
			"variant": "a",
			"file": "industrial_chemical__a.png",
			"width": 512,
			"height": 385,
			"anchor": [252, 385]
		},
		{
			"building": "vanilla:industrial_chemical",
			"variant": "b",
			"file": "industrial_chemical__b.png",
			"width": 512,
			"height": 364,
			"anchor": [257, 364]
		},
		{
			"building": "vanilla:industrial_chemical",
			"variant": "c",
			"file": "industrial_chemical__c.png",
			"width": 512,
			"height": 347,
			"anchor": [255, 347]
		},
		{
			"building": "vanilla:industrial_complex",
			"variant": "a",
			"file": "industrial_complex__a.png",
			"width": 768,
			"height": 458,
			"anchor": [371, 458]
		},
		{
			"building": "vanilla:industrial_complex",
			"variant": "b",
			"file": "industrial_complex__b.png",
			"width": 768,
			"height": 386,
			"anchor": [377, 386]
		},
		{
			"building": "vanilla:industrial_complex",
			"variant": "c",
			"file": "industrial_complex__c.png",
			"width": 768,
			"height": 411,
			"anchor": [387, 411]
		},
		{
			"building": "vanilla:industrial_foundry",
			"variant": "a",
			"file": "industrial_foundry__a.png",
			"width": 512,
			"height": 408,
			"anchor": [257, 408]
		},
		{
			"building": "vanilla:industrial_foundry",
			"variant": "b",
			"file": "industrial_foundry__b.png",
			"width": 512,
			"height": 327,
			"anchor": [255, 327]
		},
		{
			"building": "vanilla:industrial_foundry",
			"variant": "c",
			"file": "industrial_foundry__c.png",
			"width": 512,
			"height": 367,
			"anchor": [252, 367]
		},
		{
			"building": "vanilla:industrial_hall",
			"variant": "a",
			"file": "industrial_hall__a.png",
			"width": 640,
			"height": 309,
			"anchor": [384, 309]
		},
		{
			"building": "vanilla:industrial_hall",
			"variant": "b",
			"file": "industrial_hall__b.png",
			"width": 640,
			"height": 398,
			"anchor": [384, 398]
		},
		{
			"building": "vanilla:industrial_hall",
			"variant": "c",
			"file": "industrial_hall__c.png",
			"width": 640,
			"height": 329,
			"anchor": [396, 329]
		},
		{
			"building": "vanilla:industrial_large",
			"variant": "a",
			"file": "industrial_large__a.png",
			"width": 256,
			"height": 178,
			"anchor": [126, 178]
		},
		{
			"building": "vanilla:industrial_large",
			"variant": "b",
			"file": "industrial_large__b.png",
			"width": 256,
			"height": 173,
			"anchor": [126, 173]
		},
		{
			"building": "vanilla:industrial_large",
			"variant": "c",
			"file": "industrial_large__c.png",
			"width": 256,
			"height": 175,
			"anchor": [134, 175]
		},
		{
			"building": "vanilla:industrial_medium",
			"variant": "a",
			"file": "industrial_medium__a.png",
			"width": 256,
			"height": 172,
			"anchor": [125, 172]
		},
		{
			"building": "vanilla:industrial_medium",
			"variant": "b",
			"file": "industrial_medium__b.png",
			"width": 256,
			"height": 143,
			"anchor": [127, 143]
		},
		{
			"building": "vanilla:industrial_medium",
			"variant": "c",
			"file": "industrial_medium__c.png",
			"width": 256,
			"height": 158,
			"anchor": [125, 158]
		},
		{
			"building": "vanilla:industrial_park",
			"variant": "a",
			"file": "industrial_park__a.png",
			"width": 768,
			"height": 437,
			"anchor": [374, 437]
		},
		{
			"building": "vanilla:industrial_park",
			"variant": "b",
			"file": "industrial_park__b.png",
			"width": 768,
			"height": 520,
			"anchor": [397, 520]
		},
		{
			"building": "vanilla:industrial_park",
			"variant": "c",
			"file": "industrial_park__c.png",
			"width": 768,
			"height": 479,
			"anchor": [380, 479]
		},
		{
			"building": "vanilla:industrial_refinery",
			"variant": "a",
			"file": "industrial_refinery__a.png",
			"width": 768,
			"height": 514,
			"anchor": [382, 514]
		},
		{
			"building": "vanilla:industrial_refinery",
			"variant": "b",
			"file": "industrial_refinery__b.png",
			"width": 768,
			"height": 526,
			"anchor": [381, 526]
		},
		{
			"building": "vanilla:industrial_refinery",
			"variant": "c",
			"file": "industrial_refinery__c.png",
			"width": 768,
			"height": 464,
			"anchor": [386, 464]
		},
		{
			"building": "vanilla:industrial_row",
			"variant": "a",
			"file": "industrial_row__a.png",
			"width": 384,
			"height": 206,
			"anchor": [233, 206]
		},
		{
			"building": "vanilla:industrial_row",
			"variant": "b",
			"file": "industrial_row__b.png",
			"width": 384,
			"height": 254,
			"anchor": [256, 254]
		},
		{
			"building": "vanilla:industrial_row",
			"variant": "c",
			"file": "industrial_row__c.png",
			"width": 384,
			"height": 220,
			"anchor": [256, 220]
		},
		{
			"building": "vanilla:industrial_small",
			"variant": "a",
			"file": "industrial_small__a.png",
			"width": 256,
			"height": 155,
			"anchor": [127, 155]
		},
		{
			"building": "vanilla:industrial_small",
			"variant": "b",
			"file": "industrial_small__b.png",
			"width": 256,
			"height": 161,
			"anchor": [128, 161]
		},
		{
			"building": "vanilla:industrial_small",
			"variant": "c",
			"file": "industrial_small__c.png",
			"width": 256,
			"height": 152,
			"anchor": [128, 152]
		},
		{
			"building": "vanilla:industrial_smelter",
			"variant": "a",
			"file": "industrial_smelter__a.png",
			"width": 512,
			"height": 423,
			"anchor": [255, 423]
		},
		{
			"building": "vanilla:industrial_smelter",
			"variant": "b",
			"file": "industrial_smelter__b.png",
			"width": 512,
			"height": 411,
			"anchor": [265, 411]
		},
		{
			"building": "vanilla:industrial_smelter",
			"variant": "c",
			"file": "industrial_smelter__c.png",
			"width": 512,
			"height": 368,
			"anchor": [254, 368]
		},
		{
			"building": "vanilla:industrial_works",
			"variant": "a",
			"file": "industrial_works__a.png",
			"width": 512,
			"height": 299,
			"anchor": [255, 299]
		},
		{
			"building": "vanilla:industrial_works",
			"variant": "b",
			"file": "industrial_works__b.png",
			"width": 512,
			"height": 331,
			"anchor": [253, 331]
		},
		{
			"building": "vanilla:industrial_works",
			"variant": "c",
			"file": "industrial_works__c.png",
			"width": 512,
			"height": 292,
			"anchor": [253, 292]
		},
		{
			"building": "vanilla:industrial_yard",
			"variant": "a",
			"file": "industrial_yard__a.png",
			"width": 384,
			"height": 203,
			"anchor": [256, 203]
		},
		{
			"building": "vanilla:industrial_yard",
			"variant": "b",
			"file": "industrial_yard__b.png",
			"width": 384,
			"height": 465,
			"anchor": [256, 465]
		},
		{
			"building": "vanilla:industrial_yard",
			"variant": "c",
			"file": "industrial_yard__c.png",
			"width": 384,
			"height": 333,
			"anchor": [256, 333]
		},
		{
			"building": "vanilla:landfill",
			"variant": "a",
			"file": "landfill__a.png",
			"width": 768,
			"height": 375,
			"anchor": [384, 375]
		},
		{
			"building": "vanilla:landfill",
			"variant": "b",
			"file": "landfill__b.png",
			"width": 768,
			"height": 413,
			"anchor": [376, 413]
		},
		{
			"building": "vanilla:landfill",
			"variant": "c",
			"file": "landfill__c.png",
			"width": 768,
			"height": 375,
			"anchor": [382, 375]
		},
		{
			"building": "vanilla:metro_station",
			"variant": "a",
			"file": "metro_station__a.png",
			"width": 512,
			"height": 333,
			"anchor": [255, 333]
		},
		{
			"building": "vanilla:metro_station",
			"variant": "b",
			"file": "metro_station__b.png",
			"width": 512,
			"height": 295,
			"anchor": [242, 295]
		},
		{
			"building": "vanilla:metro_station",
			"variant": "c",
			"file": "metro_station__c.png",
			"width": 512,
			"height": 298,
			"anchor": [253, 298]
		},
		{
			"building": "vanilla:museum",
			"variant": "a",
			"file": "museum__a.png",
			"width": 768,
			"height": 501,
			"anchor": [381, 501]
		},
		{
			"building": "vanilla:museum",
			"variant": "b",
			"file": "museum__b.png",
			"width": 768,
			"height": 465,
			"anchor": [384, 465]
		},
		{
			"building": "vanilla:museum",
			"variant": "c",
			"file": "museum__c.png",
			"width": 768,
			"height": 478,
			"anchor": [385, 478]
		},
		{
			"building": "vanilla:nuclear_power_plant",
			"variant": "a",
			"file": "nuclear_power_plant__a.png",
			"width": 1536,
			"height": 1003,
			"anchor": [753, 1003]
		},
		{
			"building": "vanilla:nuclear_power_plant",
			"variant": "b",
			"file": "nuclear_power_plant__b.png",
			"width": 1536,
			"height": 995,
			"anchor": [773, 995]
		},
		{
			"building": "vanilla:nuclear_power_plant",
			"variant": "c",
			"file": "nuclear_power_plant__c.png",
			"width": 1536,
			"height": 812,
			"anchor": [767, 812]
		},
		{
			"building": "vanilla:park_large",
			"variant": "a",
			"file": "park_large__a.png",
			"width": 512,
			"height": 333,
			"anchor": [258, 333]
		},
		{
			"building": "vanilla:park_large",
			"variant": "b",
			"file": "park_large__b.png",
			"width": 512,
			"height": 270,
			"anchor": [248, 270]
		},
		{
			"building": "vanilla:park_large",
			"variant": "c",
			"file": "park_large__c.png",
			"width": 512,
			"height": 265,
			"anchor": [247, 265]
		},
		{
			"building": "vanilla:park_small",
			"variant": "a",
			"file": "park_small__a.png",
			"width": 256,
			"height": 195,
			"anchor": [127, 195]
		},
		{
			"building": "vanilla:park_small",
			"variant": "b",
			"file": "park_small__b.png",
			"width": 256,
			"height": 149,
			"anchor": [128, 149]
		},
		{
			"building": "vanilla:park_small",
			"variant": "c",
			"file": "park_small__c.png",
			"width": 256,
			"height": 135,
			"anchor": [128, 135]
		},
		{
			"building": "vanilla:plaza",
			"variant": "a",
			"file": "plaza__a.png",
			"width": 256,
			"height": 143,
			"anchor": [128, 143]
		},
		{
			"building": "vanilla:plaza",
			"variant": "b",
			"file": "plaza__b.png",
			"width": 256,
			"height": 131,
			"anchor": [124, 131]
		},
		{
			"building": "vanilla:plaza",
			"variant": "c",
			"file": "plaza__c.png",
			"width": 256,
			"height": 129,
			"anchor": [128, 129]
		},
		{
			"building": "vanilla:police_large",
			"variant": "a",
			"file": "police_large__a.png",
			"width": 512,
			"height": 285,
			"anchor": [257, 285]
		},
		{
			"building": "vanilla:police_large",
			"variant": "b",
			"file": "police_large__b.png",
			"width": 512,
			"height": 357,
			"anchor": [260, 357]
		},
		{
			"building": "vanilla:police_large",
			"variant": "c",
			"file": "police_large__c.png",
			"width": 512,
			"height": 388,
			"anchor": [259, 388]
		},
		{
			"building": "vanilla:police_small",
			"variant": "a",
			"file": "police_small__a.png",
			"width": 512,
			"height": 330,
			"anchor": [261, 330]
		},
		{
			"building": "vanilla:police_small",
			"variant": "b",
			"file": "police_small__b.png",
			"width": 512,
			"height": 338,
			"anchor": [252, 338]
		},
		{
			"building": "vanilla:police_small",
			"variant": "c",
			"file": "police_small__c.png",
			"width": 512,
			"height": 295,
			"anchor": [263, 295]
		},
		{
			"building": "vanilla:prison",
			"variant": "a",
			"file": "prison__a.png",
			"width": 768,
			"height": 463,
			"anchor": [385, 463]
		},
		{
			"building": "vanilla:prison",
			"variant": "b",
			"file": "prison__b.png",
			"width": 768,
			"height": 441,
			"anchor": [383, 441]
		},
		{
			"building": "vanilla:prison",
			"variant": "c",
			"file": "prison__c.png",
			"width": 768,
			"height": 383,
			"anchor": [369, 383]
		},
		{
			"building": "vanilla:pump_station",
			"variant": "a",
			"file": "pump_station__a.png",
			"width": 256,
			"height": 159,
			"anchor": [125, 159]
		},
		{
			"building": "vanilla:pump_station",
			"variant": "b",
			"file": "pump_station__b.png",
			"width": 256,
			"height": 180,
			"anchor": [124, 180]
		},
		{
			"building": "vanilla:pump_station",
			"variant": "c",
			"file": "pump_station__c.png",
			"width": 256,
			"height": 162,
			"anchor": [127, 162]
		},
		{
			"building": "vanilla:residential_court",
			"variant": "a",
			"file": "residential_court__a.png",
			"width": 512,
			"height": 287,
			"anchor": [230, 287]
		},
		{
			"building": "vanilla:residential_court",
			"variant": "b",
			"file": "residential_court__b.png",
			"width": 512,
			"height": 297,
			"anchor": [245, 297]
		},
		{
			"building": "vanilla:residential_court",
			"variant": "c",
			"file": "residential_court__c.png",
			"width": 512,
			"height": 382,
			"anchor": [254, 382]
		},
		{
			"building": "vanilla:residential_estate",
			"variant": "a",
			"file": "residential_estate__a.png",
			"width": 768,
			"height": 757,
			"anchor": [384, 757]
		},
		{
			"building": "vanilla:residential_estate",
			"variant": "b",
			"file": "residential_estate__b.png",
			"width": 768,
			"height": 475,
			"anchor": [384, 475]
		},
		{
			"building": "vanilla:residential_estate",
			"variant": "c",
			"file": "residential_estate__c.png",
			"width": 768,
			"height": 611,
			"anchor": [408, 611]
		},
		{
			"building": "vanilla:residential_highrise",
			"variant": "a",
			"file": "residential_highrise__a.png",
			"width": 512,
			"height": 506,
			"anchor": [251, 506]
		},
		{
			"building": "vanilla:residential_highrise",
			"variant": "b",
			"file": "residential_highrise__b.png",
			"width": 512,
			"height": 426,
			"anchor": [256, 426]
		},
		{
			"building": "vanilla:residential_highrise",
			"variant": "c",
			"file": "residential_highrise__c.png",
			"width": 512,
			"height": 453,
			"anchor": [256, 453]
		},
		{
			"building": "vanilla:residential_large",
			"variant": "a",
			"file": "residential_large__a.png",
			"width": 256,
			"height": 206,
			"anchor": [126, 206]
		},
		{
			"building": "vanilla:residential_large",
			"variant": "b",
			"file": "residential_large__b.png",
			"width": 256,
			"height": 186,
			"anchor": [122, 186]
		},
		{
			"building": "vanilla:residential_large",
			"variant": "c",
			"file": "residential_large__c.png",
			"width": 256,
			"height": 178,
			"anchor": [129, 178]
		},
		{
			"building": "vanilla:residential_medium",
			"variant": "a",
			"file": "residential_medium__a.png",
			"width": 256,
			"height": 158,
			"anchor": [126, 158]
		},
		{
			"building": "vanilla:residential_medium",
			"variant": "b",
			"file": "residential_medium__b.png",
			"width": 256,
			"height": 200,
			"anchor": [133, 200]
		},
		{
			"building": "vanilla:residential_medium",
			"variant": "c",
			"file": "residential_medium__c.png",
			"width": 256,
			"height": 175,
			"anchor": [131, 175]
		},
		{
			"building": "vanilla:residential_quarter",
			"variant": "a",
			"file": "residential_quarter__a.png",
			"width": 768,
			"height": 432,
			"anchor": [416, 432]
		},
		{
			"building": "vanilla:residential_quarter",
			"variant": "b",
			"file": "residential_quarter__b.png",
			"width": 768,
			"height": 545,
			"anchor": [368, 545]
		},
		{
			"building": "vanilla:residential_quarter",
			"variant": "c",
			"file": "residential_quarter__c.png",
			"width": 768,
			"height": 534,
			"anchor": [382, 534]
		},
		{
			"building": "vanilla:residential_row",
			"variant": "a",
			"file": "residential_row__a.png",
			"width": 384,
			"height": 242,
			"anchor": [262, 242]
		},
		{
			"building": "vanilla:residential_row",
			"variant": "b",
			"file": "residential_row__b.png",
			"width": 384,
			"height": 256,
			"anchor": [248, 256]
		},
		{
			"building": "vanilla:residential_row",
			"variant": "c",
			"file": "residential_row__c.png",
			"width": 384,
			"height": 218,
			"anchor": [249, 218]
		},
		{
			"building": "vanilla:residential_skyline",
			"variant": "a",
			"file": "residential_skyline__a.png",
			"width": 768,
			"height": 636,
			"anchor": [384, 636]
		},
		{
			"building": "vanilla:residential_skyline",
			"variant": "b",
			"file": "residential_skyline__b.png",
			"width": 768,
			"height": 635,
			"anchor": [383, 635]
		},
		{
			"building": "vanilla:residential_skyline",
			"variant": "c",
			"file": "residential_skyline__c.png",
			"width": 768,
			"height": 625,
			"anchor": [397, 625]
		},
		{
			"building": "vanilla:residential_small",
			"variant": "a",
			"file": "residential_small__a.png",
			"width": 256,
			"height": 129,
			"anchor": [130, 129]
		},
		{
			"building": "vanilla:residential_small",
			"variant": "b",
			"file": "residential_small__b.png",
			"width": 256,
			"height": 178,
			"anchor": [128, 178]
		},
		{
			"building": "vanilla:residential_small",
			"variant": "c",
			"file": "residential_small__c.png",
			"width": 256,
			"height": 146,
			"anchor": [127, 146]
		},
		{
			"building": "vanilla:residential_spire",
			"variant": "a",
			"file": "residential_spire__a.png",
			"width": 512,
			"height": 459,
			"anchor": [255, 459]
		},
		{
			"building": "vanilla:residential_spire",
			"variant": "b",
			"file": "residential_spire__b.png",
			"width": 512,
			"height": 532,
			"anchor": [255, 532]
		},
		{
			"building": "vanilla:residential_spire",
			"variant": "c",
			"file": "residential_spire__c.png",
			"width": 512,
			"height": 448,
			"anchor": [257, 448]
		},
		{
			"building": "vanilla:residential_terrace",
			"variant": "a",
			"file": "residential_terrace__a.png",
			"width": 384,
			"height": 211,
			"anchor": [259, 211]
		},
		{
			"building": "vanilla:residential_terrace",
			"variant": "b",
			"file": "residential_terrace__b.png",
			"width": 384,
			"height": 267,
			"anchor": [256, 267]
		},
		{
			"building": "vanilla:residential_terrace",
			"variant": "c",
			"file": "residential_terrace__c.png",
			"width": 384,
			"height": 217,
			"anchor": [244, 217]
		},
		{
			"building": "vanilla:residential_terraces",
			"variant": "a",
			"file": "residential_terraces__a.png",
			"width": 640,
			"height": 396,
			"anchor": [394, 396]
		},
		{
			"building": "vanilla:residential_terraces",
			"variant": "b",
			"file": "residential_terraces__b.png",
			"width": 640,
			"height": 408,
			"anchor": [386, 408]
		},
		{
			"building": "vanilla:residential_terraces",
			"variant": "c",
			"file": "residential_terraces__c.png",
			"width": 640,
			"height": 534,
			"anchor": [384, 534]
		},
		{
			"building": "vanilla:residential_tower",
			"variant": "a",
			"file": "residential_tower__a.png",
			"width": 512,
			"height": 379,
			"anchor": [278, 379]
		},
		{
			"building": "vanilla:residential_tower",
			"variant": "b",
			"file": "residential_tower__b.png",
			"width": 512,
			"height": 428,
			"anchor": [254, 428]
		},
		{
			"building": "vanilla:residential_tower",
			"variant": "c",
			"file": "residential_tower__c.png",
			"width": 512,
			"height": 376,
			"anchor": [266, 376]
		},
		{
			"building": "vanilla:retirement_home",
			"variant": "a",
			"file": "retirement_home__a.png",
			"width": 768,
			"height": 501,
			"anchor": [411, 501]
		},
		{
			"building": "vanilla:retirement_home",
			"variant": "b",
			"file": "retirement_home__b.png",
			"width": 768,
			"height": 454,
			"anchor": [382, 454]
		},
		{
			"building": "vanilla:retirement_home",
			"variant": "c",
			"file": "retirement_home__c.png",
			"width": 768,
			"height": 422,
			"anchor": [383, 422]
		},
		{
			"building": "ruin_1x1",
			"variant": "a",
			"file": "ruin_1x1__a.png",
			"width": 256,
			"height": 138,
			"anchor": [127, 138]
		},
		{
			"building": "ruin_1x1",
			"variant": "b",
			"file": "ruin_1x1__b.png",
			"width": 256,
			"height": 163,
			"anchor": [125, 163]
		},
		{
			"building": "ruin_1x1",
			"variant": "c",
			"file": "ruin_1x1__c.png",
			"width": 256,
			"height": 135,
			"anchor": [127, 135]
		},
		{
			"building": "ruin_2x2",
			"variant": "a",
			"file": "ruin_2x2__a.png",
			"width": 512,
			"height": 290,
			"anchor": [253, 290]
		},
		{
			"building": "ruin_2x2",
			"variant": "b",
			"file": "ruin_2x2__b.png",
			"width": 512,
			"height": 246,
			"anchor": [250, 246]
		},
		{
			"building": "ruin_2x2",
			"variant": "c",
			"file": "ruin_2x2__c.png",
			"width": 512,
			"height": 252,
			"anchor": [259, 252]
		},
		{
			"building": "ruin_3x3",
			"variant": "a",
			"file": "ruin_3x3__a.png",
			"width": 768,
			"height": 545,
			"anchor": [383, 545]
		},
		{
			"building": "ruin_3x3",
			"variant": "b",
			"file": "ruin_3x3__b.png",
			"width": 768,
			"height": 427,
			"anchor": [378, 427]
		},
		{
			"building": "ruin_3x3",
			"variant": "c",
			"file": "ruin_3x3__c.png",
			"width": 768,
			"height": 389,
			"anchor": [383, 389]
		},
		{
			"building": "ruin_4x4",
			"variant": "a",
			"file": "ruin_4x4__a.png",
			"width": 1024,
			"height": 541,
			"anchor": [508, 541]
		},
		{
			"building": "ruin_4x4",
			"variant": "b",
			"file": "ruin_4x4__b.png",
			"width": 1024,
			"height": 723,
			"anchor": [512, 723]
		},
		{
			"building": "ruin_4x4",
			"variant": "c",
			"file": "ruin_4x4__c.png",
			"width": 1024,
			"height": 523,
			"anchor": [508, 523]
		},
		{
			"building": "vanilla:school",
			"variant": "a",
			"file": "school__a.png",
			"width": 768,
			"height": 470,
			"anchor": [360, 470]
		},
		{
			"building": "vanilla:school",
			"variant": "b",
			"file": "school__b.png",
			"width": 768,
			"height": 393,
			"anchor": [420, 393]
		},
		{
			"building": "vanilla:school",
			"variant": "c",
			"file": "school__c.png",
			"width": 768,
			"height": 388,
			"anchor": [382, 388]
		},
		{
			"building": "vanilla:theatre",
			"variant": "a",
			"file": "theatre__a.png",
			"width": 512,
			"height": 403,
			"anchor": [258, 403]
		},
		{
			"building": "vanilla:theatre",
			"variant": "b",
			"file": "theatre__b.png",
			"width": 512,
			"height": 512,
			"anchor": [256, 512]
		},
		{
			"building": "vanilla:theatre",
			"variant": "c",
			"file": "theatre__c.png",
			"width": 512,
			"height": 353,
			"anchor": [254, 353]
		},
		{
			"building": "vanilla:tram_stop",
			"variant": "a",
			"file": "tram_stop__a.png",
			"width": 256,
			"height": 198,
			"anchor": [128, 198]
		},
		{
			"building": "vanilla:tram_stop",
			"variant": "b",
			"file": "tram_stop__b.png",
			"width": 256,
			"height": 181,
			"anchor": [130, 181]
		},
		{
			"building": "vanilla:tram_stop",
			"variant": "c",
			"file": "tram_stop__c.png",
			"width": 256,
			"height": 141,
			"anchor": [122, 141]
		},
		{
			"building": "vanilla:transit_depot",
			"variant": "a",
			"file": "transit_depot__a.png",
			"width": 768,
			"height": 414,
			"anchor": [383, 414]
		},
		{
			"building": "vanilla:transit_depot",
			"variant": "b",
			"file": "transit_depot__b.png",
			"width": 768,
			"height": 406,
			"anchor": [382, 406]
		},
		{
			"building": "vanilla:transit_depot",
			"variant": "c",
			"file": "transit_depot__c.png",
			"width": 768,
			"height": 427,
			"anchor": [370, 427]
		},
		{
			"building": "vanilla:transit_stop",
			"variant": "a",
			"file": "transit_stop__a.png",
			"width": 256,
			"height": 169,
			"anchor": [130, 169]
		},
		{
			"building": "vanilla:transit_stop",
			"variant": "b",
			"file": "transit_stop__b.png",
			"width": 256,
			"height": 192,
			"anchor": [128, 192]
		},
		{
			"building": "vanilla:transit_stop",
			"variant": "c",
			"file": "transit_stop__c.png",
			"width": 256,
			"height": 193,
			"anchor": [131, 193]
		},
		{
			"building": "vanilla:university",
			"variant": "a",
			"file": "university__a.png",
			"width": 768,
			"height": 637,
			"anchor": [375, 637]
		},
		{
			"building": "vanilla:university",
			"variant": "b",
			"file": "university__b.png",
			"width": 768,
			"height": 441,
			"anchor": [371, 441]
		},
		{
			"building": "vanilla:university",
			"variant": "c",
			"file": "university__c.png",
			"width": 768,
			"height": 547,
			"anchor": [381, 547]
		},
		{
			"building": "vanilla:water_treatment",
			"variant": "a",
			"file": "water_treatment__a.png",
			"width": 768,
			"height": 392,
			"anchor": [374, 392]
		},
		{
			"building": "vanilla:water_treatment",
			"variant": "b",
			"file": "water_treatment__b.png",
			"width": 768,
			"height": 359,
			"anchor": [374, 359]
		},
		{
			"building": "vanilla:water_treatment",
			"variant": "c",
			"file": "water_treatment__c.png",
			"width": 768,
			"height": 370,
			"anchor": [379, 370]
		},
		{
			"building": "vanilla:water_works",
			"variant": "a",
			"file": "water_works__a.png",
			"width": 768,
			"height": 429,
			"anchor": [378, 429]
		},
		{
			"building": "vanilla:water_works",
			"variant": "b",
			"file": "water_works__b.png",
			"width": 768,
			"height": 681,
			"anchor": [380, 681]
		},
		{
			"building": "vanilla:water_works",
			"variant": "c",
			"file": "water_works__c.png",
			"width": 768,
			"height": 460,
			"anchor": [399, 460]
		},
		{
			"building": "vanilla:wind_turbine",
			"variant": "a",
			"file": "wind_turbine__a.png",
			"width": 256,
			"height": 290,
			"anchor": [127, 290]
		},
		{
			"building": "vanilla:wind_turbine",
			"variant": "b",
			"file": "wind_turbine__b.png",
			"width": 256,
			"height": 293,
			"anchor": [128, 293]
		},
		{
			"building": "vanilla:wind_turbine",
			"variant": "c",
			"file": "wind_turbine__c.png",
			"width": 256,
			"height": 308,
			"anchor": [127, 308]
		}
	]
};
var tiles_default = {
	formatVersion: 1,
	size: 256,
	tiles: [
		{
			"tile": "asphalt_avenue",
			"shape": "a",
			"file": "asphalt_avenue__a.png",
			"size": 256
		},
		{
			"tile": "asphalt_highway",
			"shape": "a",
			"file": "asphalt_highway__a.png",
			"size": 256
		},
		{
			"tile": "asphalt_street",
			"shape": "a",
			"file": "asphalt_street__a.png",
			"size": 256
		},
		{
			"tile": "avenue",
			"shape": "0",
			"file": "avenue__0.png",
			"size": 256
		},
		{
			"tile": "avenue",
			"shape": "e",
			"file": "avenue__e.png",
			"size": 256
		},
		{
			"tile": "avenue",
			"shape": "es",
			"file": "avenue__es.png",
			"size": 256
		},
		{
			"tile": "avenue",
			"shape": "esw",
			"file": "avenue__esw.png",
			"size": 256
		},
		{
			"tile": "avenue",
			"shape": "ew",
			"file": "avenue__ew.png",
			"size": 256
		},
		{
			"tile": "avenue",
			"shape": "n",
			"file": "avenue__n.png",
			"size": 256
		},
		{
			"tile": "avenue",
			"shape": "ne",
			"file": "avenue__ne.png",
			"size": 256
		},
		{
			"tile": "avenue",
			"shape": "nes",
			"file": "avenue__nes.png",
			"size": 256
		},
		{
			"tile": "avenue",
			"shape": "nesw",
			"file": "avenue__nesw.png",
			"size": 256
		},
		{
			"tile": "avenue",
			"shape": "new",
			"file": "avenue__new.png",
			"size": 256
		},
		{
			"tile": "avenue",
			"shape": "ns",
			"file": "avenue__ns.png",
			"size": 256
		},
		{
			"tile": "avenue",
			"shape": "nsw",
			"file": "avenue__nsw.png",
			"size": 256
		},
		{
			"tile": "avenue",
			"shape": "nw",
			"file": "avenue__nw.png",
			"size": 256
		},
		{
			"tile": "avenue",
			"shape": "s",
			"file": "avenue__s.png",
			"size": 256
		},
		{
			"tile": "avenue",
			"shape": "sw",
			"file": "avenue__sw.png",
			"size": 256
		},
		{
			"tile": "avenue",
			"shape": "w",
			"file": "avenue__w.png",
			"size": 256
		},
		{
			"tile": "forest",
			"shape": "a",
			"file": "forest__a.png",
			"size": 256
		},
		{
			"tile": "forest",
			"shape": "b",
			"file": "forest__b.png",
			"size": 256
		},
		{
			"tile": "forest",
			"shape": "c",
			"file": "forest__c.png",
			"size": 256
		},
		{
			"tile": "grass",
			"shape": "a",
			"file": "grass__a.png",
			"size": 256
		},
		{
			"tile": "grass",
			"shape": "b",
			"file": "grass__b.png",
			"size": 256
		},
		{
			"tile": "grass",
			"shape": "c",
			"file": "grass__c.png",
			"size": 256
		},
		{
			"tile": "highway",
			"shape": "0",
			"file": "highway__0.png",
			"size": 256
		},
		{
			"tile": "highway",
			"shape": "e",
			"file": "highway__e.png",
			"size": 256
		},
		{
			"tile": "highway",
			"shape": "es",
			"file": "highway__es.png",
			"size": 256
		},
		{
			"tile": "highway",
			"shape": "esw",
			"file": "highway__esw.png",
			"size": 256
		},
		{
			"tile": "highway",
			"shape": "ew",
			"file": "highway__ew.png",
			"size": 256
		},
		{
			"tile": "highway",
			"shape": "n",
			"file": "highway__n.png",
			"size": 256
		},
		{
			"tile": "highway",
			"shape": "ne",
			"file": "highway__ne.png",
			"size": 256
		},
		{
			"tile": "highway",
			"shape": "nes",
			"file": "highway__nes.png",
			"size": 256
		},
		{
			"tile": "highway",
			"shape": "nesw",
			"file": "highway__nesw.png",
			"size": 256
		},
		{
			"tile": "highway",
			"shape": "new",
			"file": "highway__new.png",
			"size": 256
		},
		{
			"tile": "highway",
			"shape": "ns",
			"file": "highway__ns.png",
			"size": 256
		},
		{
			"tile": "highway",
			"shape": "nsw",
			"file": "highway__nsw.png",
			"size": 256
		},
		{
			"tile": "highway",
			"shape": "nw",
			"file": "highway__nw.png",
			"size": 256
		},
		{
			"tile": "highway",
			"shape": "s",
			"file": "highway__s.png",
			"size": 256
		},
		{
			"tile": "highway",
			"shape": "sw",
			"file": "highway__sw.png",
			"size": 256
		},
		{
			"tile": "highway",
			"shape": "w",
			"file": "highway__w.png",
			"size": 256
		},
		{
			"tile": "marsh",
			"shape": "a",
			"file": "marsh__a.png",
			"size": 256
		},
		{
			"tile": "marsh",
			"shape": "b",
			"file": "marsh__b.png",
			"size": 256
		},
		{
			"tile": "marsh",
			"shape": "c",
			"file": "marsh__c.png",
			"size": 256
		},
		{
			"tile": "pipe",
			"shape": "0",
			"file": "pipe__0.png",
			"size": 256
		},
		{
			"tile": "pipe",
			"shape": "a",
			"file": "pipe__a.png",
			"size": 256
		},
		{
			"tile": "pipe",
			"shape": "e",
			"file": "pipe__e.png",
			"size": 256
		},
		{
			"tile": "pipe",
			"shape": "es",
			"file": "pipe__es.png",
			"size": 256
		},
		{
			"tile": "pipe",
			"shape": "esw",
			"file": "pipe__esw.png",
			"size": 256
		},
		{
			"tile": "pipe",
			"shape": "ew",
			"file": "pipe__ew.png",
			"size": 256
		},
		{
			"tile": "pipe",
			"shape": "n",
			"file": "pipe__n.png",
			"size": 256
		},
		{
			"tile": "pipe",
			"shape": "ne",
			"file": "pipe__ne.png",
			"size": 256
		},
		{
			"tile": "pipe",
			"shape": "nes",
			"file": "pipe__nes.png",
			"size": 256
		},
		{
			"tile": "pipe",
			"shape": "nesw",
			"file": "pipe__nesw.png",
			"size": 256
		},
		{
			"tile": "pipe",
			"shape": "new",
			"file": "pipe__new.png",
			"size": 256
		},
		{
			"tile": "pipe",
			"shape": "ns",
			"file": "pipe__ns.png",
			"size": 256
		},
		{
			"tile": "pipe",
			"shape": "nsw",
			"file": "pipe__nsw.png",
			"size": 256
		},
		{
			"tile": "pipe",
			"shape": "nw",
			"file": "pipe__nw.png",
			"size": 256
		},
		{
			"tile": "pipe",
			"shape": "s",
			"file": "pipe__s.png",
			"size": 256
		},
		{
			"tile": "pipe",
			"shape": "sw",
			"file": "pipe__sw.png",
			"size": 256
		},
		{
			"tile": "pipe",
			"shape": "w",
			"file": "pipe__w.png",
			"size": 256
		},
		{
			"tile": "rock",
			"shape": "a",
			"file": "rock__a.png",
			"size": 256
		},
		{
			"tile": "rock",
			"shape": "b",
			"file": "rock__b.png",
			"size": 256
		},
		{
			"tile": "rock",
			"shape": "c",
			"file": "rock__c.png",
			"size": 256
		},
		{
			"tile": "sand",
			"shape": "a",
			"file": "sand__a.png",
			"size": 256
		},
		{
			"tile": "sand",
			"shape": "b",
			"file": "sand__b.png",
			"size": 256
		},
		{
			"tile": "sand",
			"shape": "c",
			"file": "sand__c.png",
			"size": 256
		},
		{
			"tile": "street",
			"shape": "0",
			"file": "street__0.png",
			"size": 256
		},
		{
			"tile": "street",
			"shape": "e",
			"file": "street__e.png",
			"size": 256
		},
		{
			"tile": "street",
			"shape": "es",
			"file": "street__es.png",
			"size": 256
		},
		{
			"tile": "street",
			"shape": "esw",
			"file": "street__esw.png",
			"size": 256
		},
		{
			"tile": "street",
			"shape": "ew",
			"file": "street__ew.png",
			"size": 256
		},
		{
			"tile": "street",
			"shape": "n",
			"file": "street__n.png",
			"size": 256
		},
		{
			"tile": "street",
			"shape": "ne",
			"file": "street__ne.png",
			"size": 256
		},
		{
			"tile": "street",
			"shape": "nes",
			"file": "street__nes.png",
			"size": 256
		},
		{
			"tile": "street",
			"shape": "nesw",
			"file": "street__nesw.png",
			"size": 256
		},
		{
			"tile": "street",
			"shape": "new",
			"file": "street__new.png",
			"size": 256
		},
		{
			"tile": "street",
			"shape": "ns",
			"file": "street__ns.png",
			"size": 256
		},
		{
			"tile": "street",
			"shape": "nsw",
			"file": "street__nsw.png",
			"size": 256
		},
		{
			"tile": "street",
			"shape": "nw",
			"file": "street__nw.png",
			"size": 256
		},
		{
			"tile": "street",
			"shape": "s",
			"file": "street__s.png",
			"size": 256
		},
		{
			"tile": "street",
			"shape": "sw",
			"file": "street__sw.png",
			"size": 256
		},
		{
			"tile": "street",
			"shape": "w",
			"file": "street__w.png",
			"size": 256
		},
		{
			"tile": "water",
			"shape": "a",
			"file": "water__a.png",
			"size": 256
		},
		{
			"tile": "water",
			"shape": "b",
			"file": "water__b.png",
			"size": 256
		},
		{
			"tile": "water",
			"shape": "c",
			"file": "water__c.png",
			"size": 256
		}
	]
};
//#endregion
//#region content/vanilla/icons/blackout.png?url
var blackout_default = "/assets/blackout-BodMHTbx.png";
//#endregion
//#region content/vanilla/icons/bond-issue.png?url
var bond_issue_default = "/assets/bond-issue-YIhh3nLy.png";
//#endregion
//#region content/vanilla/icons/budget.png?url
var budget_default = "/assets/budget-BlkSpo10.png";
//#endregion
//#region content/vanilla/icons/bulldoze.png?url
var bulldoze_default = "/assets/bulldoze-B_agApYt.png";
//#endregion
//#region content/vanilla/icons/chemicalSpill.png?url
var chemicalSpill_default = "/assets/chemicalSpill-CffMtCU1.png";
//#endregion
//#region content/vanilla/icons/cinema.png?url
var cinema_default = "/assets/cinema-D0t7KNHW.png";
//#endregion
//#region content/vanilla/icons/clinic.png?url
var clinic_default = "/assets/clinic-BnIJDTuT.png";
//#endregion
//#region content/vanilla/icons/close.png?url
var close_default = "/assets/close-CWnLviVR.png";
//#endregion
//#region content/vanilla/icons/coal_power_plant.png?url
var coal_power_plant_default = "/assets/coal_power_plant-Bq-b0RRj.png";
//#endregion
//#region content/vanilla/icons/community_centre.png?url
var community_centre_default = "/assets/community_centre-uniOB0Sd.png";
//#endregion
//#region content/vanilla/icons/coverage-culture.png?url
var coverage_culture_default = "/assets/coverage-culture-DJkfum74.png";
//#endregion
//#region content/vanilla/icons/coverage-education.png?url
var coverage_education_default = "/assets/coverage-education-CgPufheL.png";
//#endregion
//#region content/vanilla/icons/coverage-fire.png?url
var coverage_fire_default = "/assets/coverage-fire-Ba3BAD-E.png";
//#endregion
//#region content/vanilla/icons/coverage-health.png?url
var coverage_health_default = "/assets/coverage-health-CL7r1wNN.png";
//#endregion
//#region content/vanilla/icons/coverage-parks.png?url
var coverage_parks_default = "/assets/coverage-parks-CieXc3nH.png";
//#endregion
//#region content/vanilla/icons/coverage-police.png?url
var coverage_police_default = "/assets/coverage-police-DWp92rpM.png";
//#endregion
//#region content/vanilla/icons/coverage-waste.png?url
var coverage_waste_default = "/assets/coverage-waste-C0F4JX4e.png";
//#endregion
//#region content/vanilla/icons/disasters-toggle.png?url
var disasters_toggle_default = "/assets/disasters-toggle-C8N0eHfS.png";
//#endregion
//#region content/vanilla/icons/disasters.png?url
var disasters_default = "/assets/disasters-DDQRpGxW.png";
//#endregion
//#region content/vanilla/icons/download.png?url
var download_default = "/assets/download-DnGmwFcA.png";
//#endregion
//#region content/vanilla/icons/earthquake.png?url
var earthquake_default = "/assets/earthquake-9q6pk3dh.png";
//#endregion
//#region content/vanilla/icons/epidemic.png?url
var epidemic_default = "/assets/epidemic-CdkBoMMg.png";
//#endregion
//#region content/vanilla/icons/explosion.png?url
var explosion_default = "/assets/explosion-fU1W34Gp.png";
//#endregion
//#region content/vanilla/icons/fare.png?url
var fare_default = "/assets/fare-K704_Djo.png";
//#endregion
//#region content/vanilla/icons/fire.png?url
var fire_default = "/assets/fire-v-Mv2_-8.png";
//#endregion
//#region content/vanilla/icons/fire_station.png?url
var fire_station_default = "/assets/fire_station-DR-Smzi8.png";
//#endregion
//#region content/vanilla/icons/fire_station_large.png?url
var fire_station_large_default = "/assets/fire_station_large-DTM0_MTN.png";
//#endregion
//#region content/vanilla/icons/flood.png?url
var flood_default = "/assets/flood-CjXXl_zJ.png";
//#endregion
//#region content/vanilla/icons/funding.png?url
var funding_default = "/assets/funding-BOSY0Fon.png";
//#endregion
//#region content/vanilla/icons/gallery.png?url
var gallery_default = "/assets/gallery-DEiK3kYo.png";
//#endregion
//#region content/vanilla/icons/gangWar.png?url
var gangWar_default = "/assets/gangWar-Dj4_uBn-.png";
//#endregion
//#region content/vanilla/icons/high_school.png?url
var high_school_default = "/assets/high_school-BWtEP62j.png";
//#endregion
//#region content/vanilla/icons/hospital.png?url
var hospital_default = "/assets/hospital-BglQoVH5.png";
//#endregion
//#region content/vanilla/icons/incinerator.png?url
var incinerator_default = "/assets/incinerator-DvuABcLk.png";
//#endregion
//#region content/vanilla/icons/industrialAccident.png?url
var industrialAccident_default = "/assets/industrialAccident-Bx15Xlgi.png";
//#endregion
//#region content/vanilla/icons/landfill.png?url
var landfill_default = "/assets/landfill-Bv-8BVFO.png";
//#endregion
//#region content/vanilla/icons/landslide.png?url
var landslide_default = "/assets/landslide-DCsaXnMn.png";
//#endregion
//#region content/vanilla/icons/language.png?url
var language_default = "/assets/language-BLR7Bax7.png";
//#endregion
//#region content/vanilla/icons/layer-crime.png?url
var layer_crime_default = "/assets/layer-crime-C27bugGC.png";
//#endregion
//#region content/vanilla/icons/layer-happiness.png?url
var layer_happiness_default = "/assets/layer-happiness-BILS4Nab.png";
//#endregion
//#region content/vanilla/icons/layer-landvalue.png?url
var layer_landvalue_default = "/assets/layer-landvalue-C7mUIb7g.png";
//#endregion
//#region content/vanilla/icons/layer-none.png?url
var layer_none_default = "/assets/layer-none-CxeccikI.png";
//#endregion
//#region content/vanilla/icons/layer-pollution.png?url
var layer_pollution_default = "/assets/layer-pollution-TFGYAQAW.png";
//#endregion
//#region content/vanilla/icons/layer-power.png?url
var layer_power_default = "/assets/layer-power-D7t23_Xi.png";
//#endregion
//#region content/vanilla/icons/layer-traffic.png?url
var layer_traffic_default = "/assets/layer-traffic-BLKdOnk5.png";
//#endregion
//#region content/vanilla/icons/layers.png?url
var layers_default = "/assets/layers-D9lVXQYT.png";
//#endregion
//#region content/vanilla/icons/line-create.png?url
var line_create_default = "/assets/line-create-CEV6xIfX.png";
//#endregion
//#region content/vanilla/icons/line-delete.png?url
var line_delete_default = "/assets/line-delete-_anSL3dz.png";
//#endregion
//#region content/vanilla/icons/loan-repay.png?url
var loan_repay_default = "/assets/loan-repay-C6VShb-D.png";
//#endregion
//#region content/vanilla/icons/loan-take.png?url
var loan_take_default = "/assets/loan-take-CXm5yJzu.png";
//#endregion
//#region content/vanilla/icons/map-size.png?url
var map_size_default = "/assets/map-size-B6pY4n4_.png";
//#endregion
//#region content/vanilla/icons/metro_station.png?url
var metro_station_default = "/assets/metro_station-7wIa6RAH.png";
//#endregion
//#region content/vanilla/icons/museum.png?url
var museum_default = "/assets/museum-BQJ-LUCJ.png";
//#endregion
//#region content/vanilla/icons/open-file.png?url
var open_file_default = "/assets/open-file-Bg9BTONq.png";
//#endregion
//#region content/vanilla/icons/park_large.png?url
var park_large_default = "/assets/park_large-BdZT-4Vf.png";
//#endregion
//#region content/vanilla/icons/park_small.png?url
var park_small_default = "/assets/park_small-CHfOuNC2.png";
//#endregion
//#region content/vanilla/icons/pileup.png?url
var pileup_default = "/assets/pileup-y7lnWU0A.png";
//#endregion
//#region content/vanilla/icons/pipe.png?url
var pipe_default = "/assets/pipe-BeQIcY-U.png";
//#endregion
//#region content/vanilla/icons/police_large.png?url
var police_large_default = "/assets/police_large-C6mDCj_4.png";
//#endregion
//#region content/vanilla/icons/police_small.png?url
var police_small_default = "/assets/police_small-pAmorSh_.png";
//#endregion
//#region content/vanilla/icons/prison.png?url
var prison_default = "/assets/prison-DBLNnX3s.png";
//#endregion
//#region content/vanilla/icons/pump_station.png?url
var pump_station_default = "/assets/pump_station-fIrIg4-Y.png";
//#endregion
//#region content/vanilla/icons/quickload.png?url
var quickload_default = "/assets/quickload-B-Uauubc.png";
//#endregion
//#region content/vanilla/icons/quicksave.png?url
var quicksave_default = "/assets/quicksave-CFZgpyDx.png";
//#endregion
//#region content/vanilla/icons/reroll.png?url
var reroll_default = "/assets/reroll-BIB7foMJ.png";
//#endregion
//#region content/vanilla/icons/resume.png?url
var resume_default = "/assets/resume-BANtjIls.png";
//#endregion
//#region content/vanilla/icons/retirement_home.png?url
var retirement_home_default = "/assets/retirement_home-B0_XJxAF.png";
//#endregion
//#region content/vanilla/icons/riot.png?url
var riot_default = "/assets/riot-Bz8DvbqN.png";
//#endregion
//#region content/vanilla/icons/road-avenue.png?url
var road_avenue_default = "/assets/road-avenue-D_Z6SDvq.png";
//#endregion
//#region content/vanilla/icons/road-highway.png?url
var road_highway_default = "/assets/road-highway-hCXl2WKj.png";
//#endregion
//#region content/vanilla/icons/road-street.png?url
var road_street_default = "/assets/road-street-DFFGf7cb.png";
//#endregion
//#region content/vanilla/icons/save.png?url
var save_default = "/assets/save-DanXssX1.png";
//#endregion
//#region content/vanilla/icons/school.png?url
var school_default = "/assets/school-GDBp9Cf2.png";
//#endregion
//#region content/vanilla/icons/speed-1.png?url
var speed_1_default = "/assets/speed-1-CBwagd_c.png";
//#endregion
//#region content/vanilla/icons/speed-2.png?url
var speed_2_default = "/assets/speed-2-uen2UkKa.png";
//#endregion
//#region content/vanilla/icons/speed-3.png?url
var speed_3_default = "/assets/speed-3-DQmv_r3Z.png";
//#endregion
//#region content/vanilla/icons/speed-4.png?url
var speed_4_default = "/assets/speed-4-BmjwmlC5.png";
//#endregion
//#region content/vanilla/icons/speed-pause.png?url
var speed_pause_default = "/assets/speed-pause-DbMtcMu-.png";
//#endregion
//#region content/vanilla/icons/start-city.png?url
var start_city_default = "/assets/start-city-BZD1zRze.png";
//#endregion
//#region content/vanilla/icons/stop-add.png?url
var stop_add_default = "/assets/stop-add-DGW9x0Z_.png";
//#endregion
//#region content/vanilla/icons/stop-remove.png?url
var stop_remove_default = "/assets/stop-remove-KVMbNe_d.png";
//#endregion
//#region content/vanilla/icons/strike.png?url
var strike_default = "/assets/strike-D1JxEd1l.png";
//#endregion
//#region content/vanilla/icons/tax-decrease.png?url
var tax_decrease_default = "/assets/tax-decrease-Djs9BKqH.png";
//#endregion
//#region content/vanilla/icons/tax-increase.png?url
var tax_increase_default = "/assets/tax-increase-B955FvKB.png";
//#endregion
//#region content/vanilla/icons/taxes.png?url
var taxes_default = "/assets/taxes-D-vxDPsR.png";
//#endregion
//#region content/vanilla/icons/terrain-fill.png?url
var terrain_fill_default = "/assets/terrain-fill-DxkXdzez.png";
//#endregion
//#region content/vanilla/icons/terrain-level.png?url
var terrain_level_default = "/assets/terrain-level-GDaDyNf5.png";
//#endregion
//#region content/vanilla/icons/terrain-lower.png?url
var terrain_lower_default = "/assets/terrain-lower-CEqYtNJj.png";
//#endregion
//#region content/vanilla/icons/terrain-raise.png?url
var terrain_raise_default = "/assets/terrain-raise-Bd_WAY4p.png";
//#endregion
//#region content/vanilla/icons/theatre.png?url
var theatre_default = "/assets/theatre-pxWWMXf9.png";
//#endregion
//#region content/vanilla/icons/tornado.png?url
var tornado_default = "/assets/tornado-JEvQxC39.png";
//#endregion
//#region content/vanilla/icons/tram_stop.png?url
var tram_stop_default = "/assets/tram_stop-DYKmd_9V.png";
//#endregion
//#region content/vanilla/icons/transit_depot.png?url
var transit_depot_default = "/assets/transit_depot-CD81Q2vJ.png";
//#endregion
//#region content/vanilla/icons/transit_stop.png?url
var transit_stop_default = "/assets/transit_stop-DG0o9S-3.png";
//#endregion
//#region content/vanilla/icons/university.png?url
var university_default = "/assets/university-P2Kz8aze.png";
//#endregion
//#region content/vanilla/icons/vehicles.png?url
var vehicles_default = "/assets/vehicles-EGPmE2ZQ.png";
//#endregion
//#region content/vanilla/icons/view-ghost.png?url
var view_ghost_default = "/assets/view-ghost-kHTJEvP2.png";
//#endregion
//#region content/vanilla/icons/view-surface.png?url
var view_surface_default = "/assets/view-surface-Dng2o-kA.png";
//#endregion
//#region content/vanilla/icons/view-underground.png?url
var view_underground_default = "/assets/view-underground-CffW1VFs.png";
//#endregion
//#region content/vanilla/icons/water_treatment.png?url
var water_treatment_default = "/assets/water_treatment-DGtKoKXZ.png";
//#endregion
//#region content/vanilla/icons/water_works.png?url
var water_works_default = "/assets/water_works-DIH7pLgq.png";
//#endregion
//#region content/vanilla/icons/wildfire.png?url
var wildfire_default = "/assets/wildfire-Dr0Rq3YA.png";
//#endregion
//#region content/vanilla/icons/zone-clear.png?url
var zone_clear_default = "/assets/zone-clear-CElHGh4D.png";
//#endregion
//#region content/vanilla/icons/zone-commercial.png?url
var zone_commercial_default = "/assets/zone-commercial-CC4-ocm8.png";
//#endregion
//#region content/vanilla/icons/zone-industrial.png?url
var zone_industrial_default = "/assets/zone-industrial-C1ieZWxQ.png";
//#endregion
//#region content/vanilla/icons/zone-residential.png?url
var zone_residential_default = "/assets/zone-residential-JkigTKUR.png";
//#endregion
//#region content/vanilla/sprites/boulders__a.png?url
var boulders__a_default = "/assets/boulders__a-Cp-Bz1qT.png";
//#endregion
//#region content/vanilla/sprites/boulders__b.png?url
var boulders__b_default = "/assets/boulders__b-dIHJtGmn.png";
//#endregion
//#region content/vanilla/sprites/boulders__c.png?url
var boulders__c_default = "/assets/boulders__c-Bkw1l4S1.png";
//#endregion
//#region content/vanilla/sprites/cinema__a.png?url
var cinema__a_default = "/assets/cinema__a-tp2HXgMJ.png";
//#endregion
//#region content/vanilla/sprites/cinema__b.png?url
var cinema__b_default = "/assets/cinema__b-De1Zmmcw.png";
//#endregion
//#region content/vanilla/sprites/cinema__c.png?url
var cinema__c_default = "/assets/cinema__c-DF6bwnWX.png";
//#endregion
//#region content/vanilla/sprites/city_park__a.png?url
var city_park__a_default = "/assets/city_park__a-DwF4hWyz.png";
//#endregion
//#region content/vanilla/sprites/city_park__b.png?url
var city_park__b_default = "/assets/city_park__b-DjNlGoEL.png";
//#endregion
//#region content/vanilla/sprites/city_park__c.png?url
var city_park__c_default = "/assets/city_park__c-XssRVz0y.png";
//#endregion
//#region content/vanilla/sprites/clinic__a.png?url
var clinic__a_default = "/assets/clinic__a-BcwVnWX2.png";
//#endregion
//#region content/vanilla/sprites/clinic__b.png?url
var clinic__b_default = "/assets/clinic__b-DUIMFWyM.png";
//#endregion
//#region content/vanilla/sprites/clinic__c.png?url
var clinic__c_default = "/assets/clinic__c-CoFos_Xw.png";
//#endregion
//#region content/vanilla/sprites/coal_power_plant__a.png?url
var coal_power_plant__a_default = "/assets/coal_power_plant__a-D0G0sF_d.png";
//#endregion
//#region content/vanilla/sprites/coal_power_plant__b.png?url
var coal_power_plant__b_default = "/assets/coal_power_plant__b-tsdkt1Ux.png";
//#endregion
//#region content/vanilla/sprites/coal_power_plant__c.png?url
var coal_power_plant__c_default = "/assets/coal_power_plant__c-Bu2VtGoY.png";
//#endregion
//#region content/vanilla/sprites/commercial_arcade__a.png?url
var commercial_arcade__a_default = "/assets/commercial_arcade__a-DVEq-7Cc.png";
//#endregion
//#region content/vanilla/sprites/commercial_arcade__b.png?url
var commercial_arcade__b_default = "/assets/commercial_arcade__b-Bbckb1mr.png";
//#endregion
//#region content/vanilla/sprites/commercial_arcade__c.png?url
var commercial_arcade__c_default = "/assets/commercial_arcade__c-Dh4T4fBu.png";
//#endregion
//#region content/vanilla/sprites/commercial_centre__a.png?url
var commercial_centre__a_default = "/assets/commercial_centre__a-C5QzuAhg.png";
//#endregion
//#region content/vanilla/sprites/commercial_centre__b.png?url
var commercial_centre__b_default = "/assets/commercial_centre__b-DCUq-2Yn.png";
//#endregion
//#region content/vanilla/sprites/commercial_centre__c.png?url
var commercial_centre__c_default = "/assets/commercial_centre__c-DyAHPfdl.png";
//#endregion
//#region content/vanilla/sprites/commercial_downtown__a.png?url
var commercial_downtown__a_default = "/assets/commercial_downtown__a-CcJ-_beF.png";
//#endregion
//#region content/vanilla/sprites/commercial_downtown__b.png?url
var commercial_downtown__b_default = "/assets/commercial_downtown__b-bfxzmYjU.png";
//#endregion
//#region content/vanilla/sprites/commercial_downtown__c.png?url
var commercial_downtown__c_default = "/assets/commercial_downtown__c-DBHdCLex.png";
//#endregion
//#region content/vanilla/sprites/commercial_gallery__a.png?url
var commercial_gallery__a_default = "/assets/commercial_gallery__a-sLI9Jc-2.png";
//#endregion
//#region content/vanilla/sprites/commercial_gallery__b.png?url
var commercial_gallery__b_default = "/assets/commercial_gallery__b-D2fbIh4c.png";
//#endregion
//#region content/vanilla/sprites/commercial_gallery__c.png?url
var commercial_gallery__c_default = "/assets/commercial_gallery__c-CJHxpmxu.png";
//#endregion
//#region content/vanilla/sprites/commercial_highrise__a.png?url
var commercial_highrise__a_default = "/assets/commercial_highrise__a-CW30qN9E.png";
//#endregion
//#region content/vanilla/sprites/commercial_highrise__b.png?url
var commercial_highrise__b_default = "/assets/commercial_highrise__b-whJRDeTF.png";
//#endregion
//#region content/vanilla/sprites/commercial_highrise__c.png?url
var commercial_highrise__c_default = "/assets/commercial_highrise__c-C1JMu9fo.png";
//#endregion
//#region content/vanilla/sprites/commercial_large__a.png?url
var commercial_large__a_default = "/assets/commercial_large__a-DAhaufmS.png";
//#endregion
//#region content/vanilla/sprites/commercial_large__b.png?url
var commercial_large__b_default = "/assets/commercial_large__b-BT_U_J_j.png";
//#endregion
//#region content/vanilla/sprites/commercial_large__c.png?url
var commercial_large__c_default = "/assets/commercial_large__c-BvsTDT3O.png";
//#endregion
//#region content/vanilla/sprites/commercial_mall__a.png?url
var commercial_mall__a_default = "/assets/commercial_mall__a-NnwuQvaW.png";
//#endregion
//#region content/vanilla/sprites/commercial_mall__b.png?url
var commercial_mall__b_default = "/assets/commercial_mall__b-OEtIuGKP.png";
//#endregion
//#region content/vanilla/sprites/commercial_mall__c.png?url
var commercial_mall__c_default = "/assets/commercial_mall__c-dFP5rzuN.png";
//#endregion
//#region content/vanilla/sprites/commercial_medium__a.png?url
var commercial_medium__a_default = "/assets/commercial_medium__a-DpFKlY-Z.png";
//#endregion
//#region content/vanilla/sprites/commercial_medium__b.png?url
var commercial_medium__b_default = "/assets/commercial_medium__b-D2q1a1_D.png";
//#endregion
//#region content/vanilla/sprites/commercial_medium__c.png?url
var commercial_medium__c_default = "/assets/commercial_medium__c-DvBcNf7r.png";
//#endregion
//#region content/vanilla/sprites/commercial_offices__a.png?url
var commercial_offices__a_default = "/assets/commercial_offices__a-C7tf7idR.png";
//#endregion
//#region content/vanilla/sprites/commercial_offices__b.png?url
var commercial_offices__b_default = "/assets/commercial_offices__b-DxfvP2h7.png";
//#endregion
//#region content/vanilla/sprites/commercial_offices__c.png?url
var commercial_offices__c_default = "/assets/commercial_offices__c-BK1wp9_R.png";
//#endregion
//#region content/vanilla/sprites/commercial_plaza__a.png?url
var commercial_plaza__a_default = "/assets/commercial_plaza__a-BkOHQ4Ak.png";
//#endregion
//#region content/vanilla/sprites/commercial_plaza__b.png?url
var commercial_plaza__b_default = "/assets/commercial_plaza__b-g_q64s0s.png";
//#endregion
//#region content/vanilla/sprites/commercial_plaza__c.png?url
var commercial_plaza__c_default = "/assets/commercial_plaza__c--6gNhEvq.png";
//#endregion
//#region content/vanilla/sprites/commercial_row__a.png?url
var commercial_row__a_default = "/assets/commercial_row__a-ChbxkQbW.png";
//#endregion
//#region content/vanilla/sprites/commercial_row__b.png?url
var commercial_row__b_default = "/assets/commercial_row__b-BaXPvZvP.png";
//#endregion
//#region content/vanilla/sprites/commercial_row__c.png?url
var commercial_row__c_default = "/assets/commercial_row__c-C2s0j8gi.png";
//#endregion
//#region content/vanilla/sprites/commercial_small__a.png?url
var commercial_small__a_default = "/assets/commercial_small__a-xyVC6_p0.png";
//#endregion
//#region content/vanilla/sprites/commercial_small__b.png?url
var commercial_small__b_default = "/assets/commercial_small__b-BspbFTCN.png";
//#endregion
//#region content/vanilla/sprites/commercial_small__c.png?url
var commercial_small__c_default = "/assets/commercial_small__c-Bi_HmiS7.png";
//#endregion
//#region content/vanilla/sprites/commercial_tower__a.png?url
var commercial_tower__a_default = "/assets/commercial_tower__a-BQN0TEMf.png";
//#endregion
//#region content/vanilla/sprites/commercial_tower__b.png?url
var commercial_tower__b_default = "/assets/commercial_tower__b-DxSZZebR.png";
//#endregion
//#region content/vanilla/sprites/commercial_tower__c.png?url
var commercial_tower__c_default = "/assets/commercial_tower__c-BVa4Hse5.png";
//#endregion
//#region content/vanilla/sprites/community_centre__a.png?url
var community_centre__a_default = "/assets/community_centre__a-CFtm-66W.png";
//#endregion
//#region content/vanilla/sprites/community_centre__b.png?url
var community_centre__b_default = "/assets/community_centre__b-ZN8GNZvR.png";
//#endregion
//#region content/vanilla/sprites/community_centre__c.png?url
var community_centre__c_default = "/assets/community_centre__c-ChrzLNvs.png";
//#endregion
//#region content/vanilla/sprites/fire_station__a.png?url
var fire_station__a_default = "/assets/fire_station__a-pcGj4MrE.png";
//#endregion
//#region content/vanilla/sprites/fire_station__b.png?url
var fire_station__b_default = "/assets/fire_station__b-DBE5U--6.png";
//#endregion
//#region content/vanilla/sprites/fire_station__c.png?url
var fire_station__c_default = "/assets/fire_station__c-DYVRZxJx.png";
//#endregion
//#region content/vanilla/sprites/fire_station_large__a.png?url
var fire_station_large__a_default = "/assets/fire_station_large__a-AokExWfb.png";
//#endregion
//#region content/vanilla/sprites/fire_station_large__b.png?url
var fire_station_large__b_default = "/assets/fire_station_large__b-BbTf3coY.png";
//#endregion
//#region content/vanilla/sprites/fire_station_large__c.png?url
var fire_station_large__c_default = "/assets/fire_station_large__c-DN4K1Fi9.png";
//#endregion
//#region content/vanilla/sprites/forest_clump__a.png?url
var forest_clump__a_default = "/assets/forest_clump__a-QhyAsgWo.png";
//#endregion
//#region content/vanilla/sprites/forest_clump__b.png?url
var forest_clump__b_default = "/assets/forest_clump__b-BZw2P0kN.png";
//#endregion
//#region content/vanilla/sprites/forest_clump__c.png?url
var forest_clump__c_default = "/assets/forest_clump__c-RD9f-fIq.png";
//#endregion
//#region content/vanilla/sprites/gallery__a.png?url
var gallery__a_default = "/assets/gallery__a-DOarZ5FG.png";
//#endregion
//#region content/vanilla/sprites/gallery__b.png?url
var gallery__b_default = "/assets/gallery__b-PNkelDEQ.png";
//#endregion
//#region content/vanilla/sprites/gallery__c.png?url
var gallery__c_default = "/assets/gallery__c-CWejidWY.png";
//#endregion
//#region content/vanilla/sprites/gas_power_plant__a.png?url
var gas_power_plant__a_default = "/assets/gas_power_plant__a-CAMad7Sw.png";
//#endregion
//#region content/vanilla/sprites/gas_power_plant__b.png?url
var gas_power_plant__b_default = "/assets/gas_power_plant__b-ZHKyY2CC.png";
//#endregion
//#region content/vanilla/sprites/gas_power_plant__c.png?url
var gas_power_plant__c_default = "/assets/gas_power_plant__c-BNeDPxdw.png";
//#endregion
//#region content/vanilla/sprites/high_school__a.png?url
var high_school__a_default = "/assets/high_school__a-fmhC_DCt.png";
//#endregion
//#region content/vanilla/sprites/high_school__b.png?url
var high_school__b_default = "/assets/high_school__b-BFkgCn-M.png";
//#endregion
//#region content/vanilla/sprites/high_school__c.png?url
var high_school__c_default = "/assets/high_school__c-B9_GFG3F.png";
//#endregion
//#region content/vanilla/sprites/hospital__a.png?url
var hospital__a_default = "/assets/hospital__a-CUNe1mOu.png";
//#endregion
//#region content/vanilla/sprites/hospital__b.png?url
var hospital__b_default = "/assets/hospital__b-D6puSi08.png";
//#endregion
//#region content/vanilla/sprites/hospital__c.png?url
var hospital__c_default = "/assets/hospital__c-PGQI-YUz.png";
//#endregion
//#region content/vanilla/sprites/incinerator__a.png?url
var incinerator__a_default = "/assets/incinerator__a-DylXcR2N.png";
//#endregion
//#region content/vanilla/sprites/incinerator__b.png?url
var incinerator__b_default = "/assets/incinerator__b-CTx9i-Rv.png";
//#endregion
//#region content/vanilla/sprites/incinerator__c.png?url
var incinerator__c_default = "/assets/incinerator__c-Bu3rHym8.png";
//#endregion
//#region content/vanilla/sprites/industrial_chemical__a.png?url
var industrial_chemical__a_default = "/assets/industrial_chemical__a-CWxwTB6x.png";
//#endregion
//#region content/vanilla/sprites/industrial_chemical__b.png?url
var industrial_chemical__b_default = "/assets/industrial_chemical__b-D3Havyoh.png";
//#endregion
//#region content/vanilla/sprites/industrial_chemical__c.png?url
var industrial_chemical__c_default = "/assets/industrial_chemical__c-CxpgyT3B.png";
//#endregion
//#region content/vanilla/sprites/industrial_complex__a.png?url
var industrial_complex__a_default = "/assets/industrial_complex__a-Cq-nFiQ3.png";
//#endregion
//#region content/vanilla/sprites/industrial_complex__b.png?url
var industrial_complex__b_default = "/assets/industrial_complex__b-CcV45Mon.png";
//#endregion
//#region content/vanilla/sprites/industrial_complex__c.png?url
var industrial_complex__c_default = "/assets/industrial_complex__c-DDP_OrZh.png";
//#endregion
//#region content/vanilla/sprites/industrial_foundry__a.png?url
var industrial_foundry__a_default = "/assets/industrial_foundry__a-9glFSQ-V.png";
//#endregion
//#region content/vanilla/sprites/industrial_foundry__b.png?url
var industrial_foundry__b_default = "/assets/industrial_foundry__b-X49ovzJx.png";
//#endregion
//#region content/vanilla/sprites/industrial_foundry__c.png?url
var industrial_foundry__c_default = "/assets/industrial_foundry__c-BwZIvLki.png";
//#endregion
//#region content/vanilla/sprites/industrial_hall__a.png?url
var industrial_hall__a_default = "/assets/industrial_hall__a-Bp9Fx7rn.png";
//#endregion
//#region content/vanilla/sprites/industrial_hall__b.png?url
var industrial_hall__b_default = "/assets/industrial_hall__b-B96P8n0h.png";
//#endregion
//#region content/vanilla/sprites/industrial_hall__c.png?url
var industrial_hall__c_default = "/assets/industrial_hall__c-C2Gks-ar.png";
//#endregion
//#region content/vanilla/sprites/industrial_large__a.png?url
var industrial_large__a_default = "/assets/industrial_large__a-DWVjo2nQ.png";
//#endregion
//#region content/vanilla/sprites/industrial_large__b.png?url
var industrial_large__b_default = "/assets/industrial_large__b-DrhpXNW0.png";
//#endregion
//#region content/vanilla/sprites/industrial_large__c.png?url
var industrial_large__c_default = "/assets/industrial_large__c-BGkoInkb.png";
//#endregion
//#region content/vanilla/sprites/industrial_medium__a.png?url
var industrial_medium__a_default = "/assets/industrial_medium__a-dCWEBO2F.png";
//#endregion
//#region content/vanilla/sprites/industrial_medium__b.png?url
var industrial_medium__b_default = "/assets/industrial_medium__b--4ztK-N3.png";
//#endregion
//#region content/vanilla/sprites/industrial_medium__c.png?url
var industrial_medium__c_default = "/assets/industrial_medium__c-DxHLfTpe.png";
//#endregion
//#region content/vanilla/sprites/industrial_park__a.png?url
var industrial_park__a_default = "/assets/industrial_park__a-Bi76U5VO.png";
//#endregion
//#region content/vanilla/sprites/industrial_park__b.png?url
var industrial_park__b_default = "/assets/industrial_park__b-CZd9lrde.png";
//#endregion
//#region content/vanilla/sprites/industrial_park__c.png?url
var industrial_park__c_default = "/assets/industrial_park__c-B3frOCep.png";
//#endregion
//#region content/vanilla/sprites/industrial_refinery__a.png?url
var industrial_refinery__a_default = "/assets/industrial_refinery__a-CqLZAZDm.png";
//#endregion
//#region content/vanilla/sprites/industrial_refinery__b.png?url
var industrial_refinery__b_default = "/assets/industrial_refinery__b-g_3-FLDE.png";
//#endregion
//#region content/vanilla/sprites/industrial_refinery__c.png?url
var industrial_refinery__c_default = "/assets/industrial_refinery__c-C2ERKle-.png";
//#endregion
//#region content/vanilla/sprites/industrial_row__a.png?url
var industrial_row__a_default = "/assets/industrial_row__a-DT019usN.png";
//#endregion
//#region content/vanilla/sprites/industrial_row__b.png?url
var industrial_row__b_default = "/assets/industrial_row__b-CUsCTxlr.png";
//#endregion
//#region content/vanilla/sprites/industrial_row__c.png?url
var industrial_row__c_default = "/assets/industrial_row__c-Dlf8Onkx.png";
//#endregion
//#region content/vanilla/sprites/industrial_small__a.png?url
var industrial_small__a_default = "/assets/industrial_small__a-XSXs_oOp.png";
//#endregion
//#region content/vanilla/sprites/industrial_small__b.png?url
var industrial_small__b_default = "/assets/industrial_small__b-iTYvBpXF.png";
//#endregion
//#region content/vanilla/sprites/industrial_small__c.png?url
var industrial_small__c_default = "/assets/industrial_small__c-BZsf2SXS.png";
//#endregion
//#region content/vanilla/sprites/industrial_smelter__a.png?url
var industrial_smelter__a_default = "/assets/industrial_smelter__a-CEMHUYyw.png";
//#endregion
//#region content/vanilla/sprites/industrial_smelter__b.png?url
var industrial_smelter__b_default = "/assets/industrial_smelter__b-BExoBS59.png";
//#endregion
//#region content/vanilla/sprites/industrial_smelter__c.png?url
var industrial_smelter__c_default = "/assets/industrial_smelter__c-D2FwZkxP.png";
//#endregion
//#region content/vanilla/sprites/industrial_works__a.png?url
var industrial_works__a_default = "/assets/industrial_works__a-BNkwKJNk.png";
//#endregion
//#region content/vanilla/sprites/industrial_works__b.png?url
var industrial_works__b_default = "/assets/industrial_works__b-B9dmujgl.png";
//#endregion
//#region content/vanilla/sprites/industrial_works__c.png?url
var industrial_works__c_default = "/assets/industrial_works__c-C6UkiZ9X.png";
//#endregion
//#region content/vanilla/sprites/industrial_yard__a.png?url
var industrial_yard__a_default = "/assets/industrial_yard__a-C8kodEHy.png";
//#endregion
//#region content/vanilla/sprites/industrial_yard__b.png?url
var industrial_yard__b_default = "/assets/industrial_yard__b-DzkNYNKi.png";
//#endregion
//#region content/vanilla/sprites/industrial_yard__c.png?url
var industrial_yard__c_default = "/assets/industrial_yard__c-Bm23bCAi.png";
//#endregion
//#region content/vanilla/sprites/landfill__a.png?url
var landfill__a_default = "/assets/landfill__a-CshtYyqq.png";
//#endregion
//#region content/vanilla/sprites/landfill__b.png?url
var landfill__b_default = "/assets/landfill__b-l7cT0oVS.png";
//#endregion
//#region content/vanilla/sprites/landfill__c.png?url
var landfill__c_default = "/assets/landfill__c-CDkCB80R.png";
//#endregion
//#region content/vanilla/sprites/metro_station__a.png?url
var metro_station__a_default = "/assets/metro_station__a-C0dmrjQf.png";
//#endregion
//#region content/vanilla/sprites/metro_station__b.png?url
var metro_station__b_default = "/assets/metro_station__b-CHG2HcJK.png";
//#endregion
//#region content/vanilla/sprites/metro_station__c.png?url
var metro_station__c_default = "/assets/metro_station__c-ODADvGu5.png";
//#endregion
//#region content/vanilla/sprites/museum__a.png?url
var museum__a_default = "/assets/museum__a-DWcNms1R.png";
//#endregion
//#region content/vanilla/sprites/museum__b.png?url
var museum__b_default = "/assets/museum__b-DlcxSdNg.png";
//#endregion
//#region content/vanilla/sprites/museum__c.png?url
var museum__c_default = "/assets/museum__c-i_INbZjp.png";
//#endregion
//#region content/vanilla/sprites/nuclear_power_plant__a.png?url
var nuclear_power_plant__a_default = "/assets/nuclear_power_plant__a-31AdBNZi.png";
//#endregion
//#region content/vanilla/sprites/nuclear_power_plant__b.png?url
var nuclear_power_plant__b_default = "/assets/nuclear_power_plant__b-Qxz3OzHb.png";
//#endregion
//#region content/vanilla/sprites/nuclear_power_plant__c.png?url
var nuclear_power_plant__c_default = "/assets/nuclear_power_plant__c-Cpad2t0p.png";
//#endregion
//#region content/vanilla/sprites/park_large__a.png?url
var park_large__a_default = "/assets/park_large__a-yVbvb_Is.png";
//#endregion
//#region content/vanilla/sprites/park_large__b.png?url
var park_large__b_default = "/assets/park_large__b-tWJowAja.png";
//#endregion
//#region content/vanilla/sprites/park_large__c.png?url
var park_large__c_default = "/assets/park_large__c-CXsLBHEU.png";
//#endregion
//#region content/vanilla/sprites/park_small__a.png?url
var park_small__a_default = "/assets/park_small__a-DcHnAcDI.png";
//#endregion
//#region content/vanilla/sprites/park_small__b.png?url
var park_small__b_default = "/assets/park_small__b-Dci6sCWy.png";
//#endregion
//#region content/vanilla/sprites/park_small__c.png?url
var park_small__c_default = "/assets/park_small__c-Dcl1u6Aj.png";
//#endregion
//#region content/vanilla/sprites/plaza__a.png?url
var plaza__a_default = "/assets/plaza__a-C9uhUUV7.png";
//#endregion
//#region content/vanilla/sprites/plaza__b.png?url
var plaza__b_default = "/assets/plaza__b-DfuRoFqG.png";
//#endregion
//#region content/vanilla/sprites/plaza__c.png?url
var plaza__c_default = "/assets/plaza__c-qJ6CGdRC.png";
//#endregion
//#region content/vanilla/sprites/police_large__a.png?url
var police_large__a_default = "/assets/police_large__a-Cflt0UXF.png";
//#endregion
//#region content/vanilla/sprites/police_large__b.png?url
var police_large__b_default = "/assets/police_large__b-CcI53VuL.png";
//#endregion
//#region content/vanilla/sprites/police_large__c.png?url
var police_large__c_default = "/assets/police_large__c-BEm_Cbly.png";
//#endregion
//#region content/vanilla/sprites/police_small__a.png?url
var police_small__a_default = "/assets/police_small__a-BE-coiRE.png";
//#endregion
//#region content/vanilla/sprites/police_small__b.png?url
var police_small__b_default = "/assets/police_small__b-D3f8Mzsf.png";
//#endregion
//#region content/vanilla/sprites/police_small__c.png?url
var police_small__c_default = "/assets/police_small__c-ByPbHyAU.png";
//#endregion
//#region content/vanilla/sprites/prison__a.png?url
var prison__a_default = "/assets/prison__a-DznMjaNB.png";
//#endregion
//#region content/vanilla/sprites/prison__b.png?url
var prison__b_default = "/assets/prison__b-DPMFXbnF.png";
//#endregion
//#region content/vanilla/sprites/prison__c.png?url
var prison__c_default = "/assets/prison__c-CjiBP81j.png";
//#endregion
//#region content/vanilla/sprites/pump_station__a.png?url
var pump_station__a_default = "/assets/pump_station__a-CirbY8_0.png";
//#endregion
//#region content/vanilla/sprites/pump_station__b.png?url
var pump_station__b_default = "/assets/pump_station__b-B5UaIPKo.png";
//#endregion
//#region content/vanilla/sprites/pump_station__c.png?url
var pump_station__c_default = "/assets/pump_station__c-D3XW0S-Z.png";
//#endregion
//#region content/vanilla/sprites/residential_court__a.png?url
var residential_court__a_default = "/assets/residential_court__a-CkThGUTJ.png";
//#endregion
//#region content/vanilla/sprites/residential_court__b.png?url
var residential_court__b_default = "/assets/residential_court__b-jf3xAwC2.png";
//#endregion
//#region content/vanilla/sprites/residential_court__c.png?url
var residential_court__c_default = "/assets/residential_court__c-ykVELdNz.png";
//#endregion
//#region content/vanilla/sprites/residential_estate__a.png?url
var residential_estate__a_default = "/assets/residential_estate__a-Ck9o5CmB.png";
//#endregion
//#region content/vanilla/sprites/residential_estate__b.png?url
var residential_estate__b_default = "/assets/residential_estate__b-WHlXeom3.png";
//#endregion
//#region content/vanilla/sprites/residential_estate__c.png?url
var residential_estate__c_default = "/assets/residential_estate__c-D25-1v5m.png";
//#endregion
//#region content/vanilla/sprites/residential_highrise__a.png?url
var residential_highrise__a_default = "/assets/residential_highrise__a-DsQA9MAZ.png";
//#endregion
//#region content/vanilla/sprites/residential_highrise__b.png?url
var residential_highrise__b_default = "/assets/residential_highrise__b-DjpQt_L1.png";
//#endregion
//#region content/vanilla/sprites/residential_highrise__c.png?url
var residential_highrise__c_default = "/assets/residential_highrise__c-DSoAPRR7.png";
//#endregion
//#region content/vanilla/sprites/residential_large__a.png?url
var residential_large__a_default = "/assets/residential_large__a-PIzl6urC.png";
//#endregion
//#region content/vanilla/sprites/residential_large__b.png?url
var residential_large__b_default = "/assets/residential_large__b-Dy7gEYxS.png";
//#endregion
//#region content/vanilla/sprites/residential_large__c.png?url
var residential_large__c_default = "/assets/residential_large__c-ob_TH3uu.png";
//#endregion
//#region content/vanilla/sprites/residential_medium__a.png?url
var residential_medium__a_default = "/assets/residential_medium__a-18U_JNzQ.png";
//#endregion
//#region content/vanilla/sprites/residential_medium__b.png?url
var residential_medium__b_default = "/assets/residential_medium__b-CcDPBb9H.png";
//#endregion
//#region content/vanilla/sprites/residential_medium__c.png?url
var residential_medium__c_default = "/assets/residential_medium__c-CmvrT0px.png";
//#endregion
//#region content/vanilla/sprites/residential_quarter__a.png?url
var residential_quarter__a_default = "/assets/residential_quarter__a-BrwlsNpd.png";
//#endregion
//#region content/vanilla/sprites/residential_quarter__b.png?url
var residential_quarter__b_default = "/assets/residential_quarter__b-BmlwDvst.png";
//#endregion
//#region content/vanilla/sprites/residential_quarter__c.png?url
var residential_quarter__c_default = "/assets/residential_quarter__c-Do7gFo01.png";
//#endregion
//#region content/vanilla/sprites/residential_row__a.png?url
var residential_row__a_default = "/assets/residential_row__a-WMgP9UqJ.png";
//#endregion
//#region content/vanilla/sprites/residential_row__b.png?url
var residential_row__b_default = "/assets/residential_row__b-D72VIhgw.png";
//#endregion
//#region content/vanilla/sprites/residential_row__c.png?url
var residential_row__c_default = "/assets/residential_row__c-BJyZmc4w.png";
//#endregion
//#region content/vanilla/sprites/residential_skyline__a.png?url
var residential_skyline__a_default = "/assets/residential_skyline__a-DdY-k8_4.png";
//#endregion
//#region content/vanilla/sprites/residential_skyline__b.png?url
var residential_skyline__b_default = "/assets/residential_skyline__b-BtQkCtH4.png";
//#endregion
//#region content/vanilla/sprites/residential_skyline__c.png?url
var residential_skyline__c_default = "/assets/residential_skyline__c-EyN10_gr.png";
//#endregion
//#region content/vanilla/sprites/residential_small__a.png?url
var residential_small__a_default = "/assets/residential_small__a-DUmYFFVZ.png";
//#endregion
//#region content/vanilla/sprites/residential_small__b.png?url
var residential_small__b_default = "/assets/residential_small__b-g6OyawVb.png";
//#endregion
//#region content/vanilla/sprites/residential_small__c.png?url
var residential_small__c_default = "/assets/residential_small__c-CLR0oyhq.png";
//#endregion
//#region content/vanilla/sprites/residential_spire__a.png?url
var residential_spire__a_default = "/assets/residential_spire__a-EpWjSicB.png";
//#endregion
//#region content/vanilla/sprites/residential_spire__b.png?url
var residential_spire__b_default = "/assets/residential_spire__b-CbeI9Jwj.png";
//#endregion
//#region content/vanilla/sprites/residential_spire__c.png?url
var residential_spire__c_default = "/assets/residential_spire__c-BwIHJMYY.png";
//#endregion
//#region content/vanilla/sprites/residential_terrace__a.png?url
var residential_terrace__a_default = "/assets/residential_terrace__a-BKbARSTL.png";
//#endregion
//#region content/vanilla/sprites/residential_terrace__b.png?url
var residential_terrace__b_default = "/assets/residential_terrace__b-BI6mUWoE.png";
//#endregion
//#region content/vanilla/sprites/residential_terrace__c.png?url
var residential_terrace__c_default = "/assets/residential_terrace__c-BUoCGm4S.png";
//#endregion
//#region content/vanilla/sprites/residential_terraces__a.png?url
var residential_terraces__a_default = "/assets/residential_terraces__a-BB56yi6A.png";
//#endregion
//#region content/vanilla/sprites/residential_terraces__b.png?url
var residential_terraces__b_default = "/assets/residential_terraces__b-Cp82GV1S.png";
//#endregion
//#region content/vanilla/sprites/residential_terraces__c.png?url
var residential_terraces__c_default = "/assets/residential_terraces__c-DGyWg88a.png";
//#endregion
//#region content/vanilla/sprites/residential_tower__a.png?url
var residential_tower__a_default = "/assets/residential_tower__a-DlzYfwq7.png";
//#endregion
//#region content/vanilla/sprites/residential_tower__b.png?url
var residential_tower__b_default = "/assets/residential_tower__b-DI7_yIar.png";
//#endregion
//#region content/vanilla/sprites/residential_tower__c.png?url
var residential_tower__c_default = "/assets/residential_tower__c-CEuviFSy.png";
//#endregion
//#region content/vanilla/sprites/retirement_home__a.png?url
var retirement_home__a_default = "/assets/retirement_home__a-C7OopjGq.png";
//#endregion
//#region content/vanilla/sprites/retirement_home__b.png?url
var retirement_home__b_default = "/assets/retirement_home__b-TUMMSHBw.png";
//#endregion
//#region content/vanilla/sprites/retirement_home__c.png?url
var retirement_home__c_default = "/assets/retirement_home__c-CkJgfKrY.png";
//#endregion
//#region content/vanilla/sprites/ruin_1x1__a.png?url
var ruin_1x1__a_default = "/assets/ruin_1x1__a-BWSQHAod.png";
//#endregion
//#region content/vanilla/sprites/ruin_1x1__b.png?url
var ruin_1x1__b_default = "/assets/ruin_1x1__b-DOJekqpe.png";
//#endregion
//#region content/vanilla/sprites/ruin_1x1__c.png?url
var ruin_1x1__c_default = "/assets/ruin_1x1__c-Buz2dud0.png";
//#endregion
//#region content/vanilla/sprites/ruin_2x2__a.png?url
var ruin_2x2__a_default = "/assets/ruin_2x2__a-D7VsKG6C.png";
//#endregion
//#region content/vanilla/sprites/ruin_2x2__b.png?url
var ruin_2x2__b_default = "/assets/ruin_2x2__b-DF3bNevD.png";
//#endregion
//#region content/vanilla/sprites/ruin_2x2__c.png?url
var ruin_2x2__c_default = "/assets/ruin_2x2__c-DYra08Fd.png";
//#endregion
//#region content/vanilla/sprites/ruin_3x3__a.png?url
var ruin_3x3__a_default = "/assets/ruin_3x3__a-dhr4R4Le.png";
//#endregion
//#region content/vanilla/sprites/ruin_3x3__b.png?url
var ruin_3x3__b_default = "/assets/ruin_3x3__b-NZjA9DRn.png";
//#endregion
//#region content/vanilla/sprites/ruin_3x3__c.png?url
var ruin_3x3__c_default = "/assets/ruin_3x3__c-hGwf7OvH.png";
//#endregion
//#region content/vanilla/sprites/ruin_4x4__a.png?url
var ruin_4x4__a_default = "/assets/ruin_4x4__a-EMRjLPYv.png";
//#endregion
//#region content/vanilla/sprites/ruin_4x4__b.png?url
var ruin_4x4__b_default = "/assets/ruin_4x4__b-DiCwai4n.png";
//#endregion
//#region content/vanilla/sprites/ruin_4x4__c.png?url
var ruin_4x4__c_default = "/assets/ruin_4x4__c-XBDZvk5H.png";
//#endregion
//#region content/vanilla/sprites/school__a.png?url
var school__a_default = "/assets/school__a-BLdM4s7-.png";
//#endregion
//#region content/vanilla/sprites/school__b.png?url
var school__b_default = "/assets/school__b-CuvLnC6J.png";
//#endregion
//#region content/vanilla/sprites/school__c.png?url
var school__c_default = "/assets/school__c-DjxUSBsr.png";
//#endregion
//#region content/vanilla/sprites/theatre__a.png?url
var theatre__a_default = "/assets/theatre__a-PeaBDFwi.png";
//#endregion
//#region content/vanilla/sprites/theatre__b.png?url
var theatre__b_default = "/assets/theatre__b-CeKDYojm.png";
//#endregion
//#region content/vanilla/sprites/theatre__c.png?url
var theatre__c_default = "/assets/theatre__c-BnYoLpDg.png";
//#endregion
//#region content/vanilla/sprites/tram_stop__a.png?url
var tram_stop__a_default = "/assets/tram_stop__a-B40Nd3Yt.png";
//#endregion
//#region content/vanilla/sprites/tram_stop__b.png?url
var tram_stop__b_default = "/assets/tram_stop__b-DoEfvRni.png";
//#endregion
//#region content/vanilla/sprites/tram_stop__c.png?url
var tram_stop__c_default = "/assets/tram_stop__c-Bae6E9pQ.png";
//#endregion
//#region content/vanilla/sprites/transit_depot__a.png?url
var transit_depot__a_default = "/assets/transit_depot__a-DIqJV63E.png";
//#endregion
//#region content/vanilla/sprites/transit_depot__b.png?url
var transit_depot__b_default = "/assets/transit_depot__b-CuaLt5JE.png";
//#endregion
//#region content/vanilla/sprites/transit_depot__c.png?url
var transit_depot__c_default = "/assets/transit_depot__c-bmXiq2Sq.png";
//#endregion
//#region content/vanilla/sprites/transit_stop__a.png?url
var transit_stop__a_default = "/assets/transit_stop__a-DOMWS_cX.png";
//#endregion
//#region content/vanilla/sprites/transit_stop__b.png?url
var transit_stop__b_default = "/assets/transit_stop__b-CF0dplfC.png";
//#endregion
//#region content/vanilla/sprites/transit_stop__c.png?url
var transit_stop__c_default = "/assets/transit_stop__c-BwvHja5Y.png";
//#endregion
//#region content/vanilla/sprites/university__a.png?url
var university__a_default = "/assets/university__a-DItsXF0x.png";
//#endregion
//#region content/vanilla/sprites/university__b.png?url
var university__b_default = "/assets/university__b-BLTN1xom.png";
//#endregion
//#region content/vanilla/sprites/university__c.png?url
var university__c_default = "/assets/university__c--I_fUpJm.png";
//#endregion
//#region content/vanilla/sprites/water_treatment__a.png?url
var water_treatment__a_default = "/assets/water_treatment__a-CxG_5RXt.png";
//#endregion
//#region content/vanilla/sprites/water_treatment__b.png?url
var water_treatment__b_default = "/assets/water_treatment__b-DR06ucfK.png";
//#endregion
//#region content/vanilla/sprites/water_treatment__c.png?url
var water_treatment__c_default = "/assets/water_treatment__c-DdiUgVLs.png";
//#endregion
//#region content/vanilla/sprites/water_works__a.png?url
var water_works__a_default = "/assets/water_works__a-DBmIWLMN.png";
//#endregion
//#region content/vanilla/sprites/water_works__b.png?url
var water_works__b_default = "/assets/water_works__b-CoYPgYyH.png";
//#endregion
//#region content/vanilla/sprites/water_works__c.png?url
var water_works__c_default = "/assets/water_works__c-C_mDBmIi.png";
//#endregion
//#region content/vanilla/sprites/wind_turbine__a.png?url
var wind_turbine__a_default = "/assets/wind_turbine__a-CxrqQQti.png";
//#endregion
//#region content/vanilla/sprites/wind_turbine__b.png?url
var wind_turbine__b_default = "/assets/wind_turbine__b-B5Ltfl-g.png";
//#endregion
//#region content/vanilla/sprites/wind_turbine__c.png?url
var wind_turbine__c_default = "/assets/wind_turbine__c-DFacUU7D.png";
//#endregion
//#region content/vanilla/tiles/asphalt_avenue__a.png?url
var asphalt_avenue__a_default = "/assets/asphalt_avenue__a-rO73nBht.png";
//#endregion
//#region content/vanilla/tiles/asphalt_highway__a.png?url
var asphalt_highway__a_default = "/assets/asphalt_highway__a-DmvJKtKW.png";
//#endregion
//#region content/vanilla/tiles/asphalt_street__a.png?url
var asphalt_street__a_default = "/assets/asphalt_street__a-DLNix90k.png";
//#endregion
//#region content/vanilla/tiles/avenue__0.png?url
var avenue__0_default = "/assets/avenue__0-_b15CmEd.png";
//#endregion
//#region content/vanilla/tiles/avenue__e.png?url
var avenue__e_default = "/assets/avenue__e-Ch_RDOK6.png";
//#endregion
//#region content/vanilla/tiles/avenue__es.png?url
var avenue__es_default = "/assets/avenue__es-CPTmdkQF.png";
//#endregion
//#region content/vanilla/tiles/avenue__esw.png?url
var avenue__esw_default = "/assets/avenue__esw-CHkVNmV1.png";
//#endregion
//#region content/vanilla/tiles/avenue__ew.png?url
var avenue__ew_default = "/assets/avenue__ew-lT_a8Nwm.png";
//#endregion
//#region content/vanilla/tiles/avenue__n.png?url
var avenue__n_default = "/assets/avenue__n-LgVCYbam.png";
//#endregion
//#region content/vanilla/tiles/avenue__ne.png?url
var avenue__ne_default = "/assets/avenue__ne-CeuwmDZ5.png";
//#endregion
//#region content/vanilla/tiles/avenue__nes.png?url
var avenue__nes_default = "/assets/avenue__nes-Du0_clwx.png";
//#endregion
//#region content/vanilla/tiles/avenue__nesw.png?url
var avenue__nesw_default = "/assets/avenue__nesw-BjdQA0o6.png";
//#endregion
//#region content/vanilla/tiles/avenue__new.png?url
var avenue__new_default = "/assets/avenue__new-DTgO2ydX.png";
//#endregion
//#region content/vanilla/tiles/avenue__ns.png?url
var avenue__ns_default = "/assets/avenue__ns-C8fVpVsq.png";
//#endregion
//#region content/vanilla/tiles/avenue__nsw.png?url
var avenue__nsw_default = "/assets/avenue__nsw-R8phFiEZ.png";
//#endregion
//#region content/vanilla/tiles/avenue__nw.png?url
var avenue__nw_default = "/assets/avenue__nw-BktX9OxI.png";
//#endregion
//#region content/vanilla/tiles/avenue__s.png?url
var avenue__s_default = "/assets/avenue__s-B7zfBiw6.png";
//#endregion
//#region content/vanilla/tiles/avenue__sw.png?url
var avenue__sw_default = "/assets/avenue__sw-CnvlxoSA.png";
//#endregion
//#region content/vanilla/tiles/avenue__w.png?url
var avenue__w_default = "/assets/avenue__w-CqPkaJ8c.png";
//#endregion
//#region content/vanilla/tiles/forest__a.png?url
var forest__a_default = "/assets/forest__a-sbTHmt7I.png";
//#endregion
//#region content/vanilla/tiles/forest__b.png?url
var forest__b_default = "/assets/forest__b-BRo254db.png";
//#endregion
//#region content/vanilla/tiles/forest__c.png?url
var forest__c_default = "/assets/forest__c-Du4BRJg6.png";
//#endregion
//#region content/vanilla/tiles/grass__a.png?url
var grass__a_default = "/assets/grass__a-Dy6Xl4dv.png";
//#endregion
//#region content/vanilla/tiles/grass__b.png?url
var grass__b_default = "/assets/grass__b-BVIXfMnn.png";
//#endregion
//#region content/vanilla/tiles/grass__c.png?url
var grass__c_default = "/assets/grass__c-B7lsWxQH.png";
//#endregion
//#region content/vanilla/tiles/highway__0.png?url
var highway__0_default = "/assets/highway__0-5PBistoq.png";
//#endregion
//#region content/vanilla/tiles/highway__e.png?url
var highway__e_default = "/assets/highway__e-NMKsrJBv.png";
//#endregion
//#region content/vanilla/tiles/highway__es.png?url
var highway__es_default = "/assets/highway__es-C-kfXoP1.png";
//#endregion
//#region content/vanilla/tiles/highway__esw.png?url
var highway__esw_default = "/assets/highway__esw-VxGo2BaN.png";
//#endregion
//#region content/vanilla/tiles/highway__ew.png?url
var highway__ew_default = "/assets/highway__ew-DkI4LVWO.png";
//#endregion
//#region content/vanilla/tiles/highway__n.png?url
var highway__n_default = "/assets/highway__n-CH4Msg-t.png";
//#endregion
//#region content/vanilla/tiles/highway__ne.png?url
var highway__ne_default = "/assets/highway__ne-D0mO-opz.png";
//#endregion
//#region content/vanilla/tiles/highway__nes.png?url
var highway__nes_default = "/assets/highway__nes-BGdRzPjI.png";
//#endregion
//#region content/vanilla/tiles/highway__nesw.png?url
var highway__nesw_default = "/assets/highway__nesw-DdWe-gQM.png";
//#endregion
//#region content/vanilla/tiles/highway__new.png?url
var highway__new_default = "/assets/highway__new-DvLB0uHE.png";
//#endregion
//#region content/vanilla/tiles/highway__ns.png?url
var highway__ns_default = "/assets/highway__ns-BFOefz2k.png";
//#endregion
//#region content/vanilla/tiles/highway__nsw.png?url
var highway__nsw_default = "/assets/highway__nsw-7fCcZxrA.png";
//#endregion
//#region content/vanilla/tiles/highway__nw.png?url
var highway__nw_default = "/assets/highway__nw-BdpH9yl5.png";
//#endregion
//#region content/vanilla/tiles/highway__s.png?url
var highway__s_default = "/assets/highway__s-1aiah9TX.png";
//#endregion
//#region content/vanilla/tiles/highway__sw.png?url
var highway__sw_default = "/assets/highway__sw-C_0E68Eq.png";
//#endregion
//#region content/vanilla/tiles/highway__w.png?url
var highway__w_default = "/assets/highway__w-CCfd0L3X.png";
//#endregion
//#region content/vanilla/tiles/marsh__a.png?url
var marsh__a_default = "/assets/marsh__a-CUMhm9fu.png";
//#endregion
//#region content/vanilla/tiles/marsh__b.png?url
var marsh__b_default = "/assets/marsh__b-Du7mvDMu.png";
//#endregion
//#region content/vanilla/tiles/marsh__c.png?url
var marsh__c_default = "/assets/marsh__c-DFc83vQ9.png";
//#endregion
//#region content/vanilla/tiles/pipe__0.png?url
var pipe__0_default = "/assets/pipe__0-C84K1EJD.png";
//#endregion
//#region content/vanilla/tiles/pipe__a.png?url
var pipe__a_default = "/assets/pipe__a-T1rQ2f3U.png";
//#endregion
//#region content/vanilla/tiles/pipe__e.png?url
var pipe__e_default = "/assets/pipe__e-BUBxONzy.png";
//#endregion
//#region content/vanilla/tiles/pipe__es.png?url
var pipe__es_default = "/assets/pipe__es-D02UmWbr.png";
//#endregion
//#region content/vanilla/tiles/pipe__esw.png?url
var pipe__esw_default = "/assets/pipe__esw-DYSViSfu.png";
//#endregion
//#region content/vanilla/tiles/pipe__ew.png?url
var pipe__ew_default = "/assets/pipe__ew-DvZ6eVW3.png";
//#endregion
//#region content/vanilla/tiles/pipe__n.png?url
var pipe__n_default = "/assets/pipe__n-Db58E7tM.png";
//#endregion
//#region content/vanilla/tiles/pipe__ne.png?url
var pipe__ne_default = "/assets/pipe__ne-CPlVF7IH.png";
//#endregion
//#region content/vanilla/tiles/pipe__nes.png?url
var pipe__nes_default = "/assets/pipe__nes-CylQ7zyU.png";
//#endregion
//#region content/vanilla/tiles/pipe__nesw.png?url
var pipe__nesw_default = "/assets/pipe__nesw-B08C57Qt.png";
//#endregion
//#region content/vanilla/tiles/pipe__new.png?url
var pipe__new_default = "/assets/pipe__new-D64W5d1z.png";
//#endregion
//#region content/vanilla/tiles/pipe__ns.png?url
var pipe__ns_default = "/assets/pipe__ns-CVCDpzaY.png";
//#endregion
//#region content/vanilla/tiles/pipe__nsw.png?url
var pipe__nsw_default = "/assets/pipe__nsw-ASybx0jo.png";
//#endregion
//#region content/vanilla/tiles/pipe__nw.png?url
var pipe__nw_default = "/assets/pipe__nw-CP9LXlxx.png";
//#endregion
//#region content/vanilla/tiles/pipe__s.png?url
var pipe__s_default = "/assets/pipe__s-DsYdye5t.png";
//#endregion
//#region content/vanilla/tiles/pipe__sw.png?url
var pipe__sw_default = "/assets/pipe__sw-Ay4LAYen.png";
//#endregion
//#region content/vanilla/tiles/pipe__w.png?url
var pipe__w_default = "/assets/pipe__w-C0CU2yD-.png";
//#endregion
//#region content/vanilla/tiles/rock__a.png?url
var rock__a_default = "/assets/rock__a-TpPGeKRz.png";
//#endregion
//#region content/vanilla/tiles/rock__b.png?url
var rock__b_default = "/assets/rock__b-m8uC6v64.png";
//#endregion
//#region content/vanilla/tiles/rock__c.png?url
var rock__c_default = "/assets/rock__c-DX43X0NV.png";
//#endregion
//#region content/vanilla/tiles/sand__a.png?url
var sand__a_default = "/assets/sand__a-CEFIZ4_z.png";
//#endregion
//#region content/vanilla/tiles/sand__b.png?url
var sand__b_default = "/assets/sand__b-DvX4sdTJ.png";
//#endregion
//#region content/vanilla/tiles/sand__c.png?url
var sand__c_default = "/assets/sand__c-C56_TLTL.png";
//#endregion
//#region content/vanilla/tiles/street__0.png?url
var street__0_default = "/assets/street__0-yFl7uRur.png";
//#endregion
//#region content/vanilla/tiles/street__e.png?url
var street__e_default = "/assets/street__e-Cd5Y-N5S.png";
//#endregion
//#region content/vanilla/tiles/street__es.png?url
var street__es_default = "/assets/street__es-DxBybyn9.png";
//#endregion
//#region content/vanilla/tiles/street__esw.png?url
var street__esw_default = "/assets/street__esw-H9kFKUZF.png";
//#endregion
//#region content/vanilla/tiles/street__ew.png?url
var street__ew_default = "/assets/street__ew-B4-0QxbD.png";
//#endregion
//#region content/vanilla/tiles/street__n.png?url
var street__n_default = "/assets/street__n-BbafQ9jE.png";
//#endregion
//#region content/vanilla/tiles/street__ne.png?url
var street__ne_default = "/assets/street__ne-CMDPHgeW.png";
//#endregion
//#region content/vanilla/tiles/street__nes.png?url
var street__nes_default = "/assets/street__nes-7Xsfx1kl.png";
//#endregion
//#region content/vanilla/tiles/street__nesw.png?url
var street__nesw_default = "/assets/street__nesw-BpPBLhsb.png";
//#endregion
//#region content/vanilla/tiles/street__new.png?url
var street__new_default = "/assets/street__new-BcvC9EaA.png";
//#endregion
//#region content/vanilla/tiles/street__ns.png?url
var street__ns_default = "/assets/street__ns-CsKKZznn.png";
//#endregion
//#region content/vanilla/tiles/street__nsw.png?url
var street__nsw_default = "/assets/street__nsw-BiiQjLBW.png";
//#endregion
//#region content/vanilla/tiles/street__nw.png?url
var street__nw_default = "/assets/street__nw-BDYEdgc0.png";
//#endregion
//#region content/vanilla/tiles/street__s.png?url
var street__s_default = "/assets/street__s-C6XBvHtn.png";
//#endregion
//#region content/vanilla/tiles/street__sw.png?url
var street__sw_default = "/assets/street__sw-9Hp236yP.png";
//#endregion
//#region content/vanilla/tiles/street__w.png?url
var street__w_default = "/assets/street__w-CSWpL-fk.png";
//#endregion
//#region content/vanilla/tiles/water__a.png?url
var water__a_default = "/assets/water__a-By7qqvXv.png";
//#endregion
//#region content/vanilla/tiles/water__b.png?url
var water__b_default = "/assets/water__b-Ckccau8R.png";
//#endregion
//#region content/vanilla/tiles/water__c.png?url
var water__c_default = "/assets/water__c-BOs5lC--.png";
//#endregion
//#region src/content/loader.ts
var SOURCE_ROOT = "content/vanilla/";
function relativePath(absolute) {
	const at = absolute.indexOf(SOURCE_ROOT);
	return at === -1 ? absolute : absolute.slice(at + 16);
}
function createVanillaSource() {
	const modules = /* #__PURE__ */ Object.assign({
		"../../content/vanilla/balance.json": balance_default,
		"../../content/vanilla/buildings/cinema.json": cinema_default$1,
		"../../content/vanilla/buildings/city_park.json": city_park_default,
		"../../content/vanilla/buildings/clinic.json": clinic_default$1,
		"../../content/vanilla/buildings/coal_power_plant.json": coal_power_plant_default$1,
		"../../content/vanilla/buildings/commercial_arcade.json": commercial_arcade_default,
		"../../content/vanilla/buildings/commercial_centre.json": commercial_centre_default,
		"../../content/vanilla/buildings/commercial_downtown.json": commercial_downtown_default,
		"../../content/vanilla/buildings/commercial_gallery.json": commercial_gallery_default,
		"../../content/vanilla/buildings/commercial_highrise.json": commercial_highrise_default,
		"../../content/vanilla/buildings/commercial_large.json": commercial_large_default,
		"../../content/vanilla/buildings/commercial_mall.json": commercial_mall_default,
		"../../content/vanilla/buildings/commercial_medium.json": commercial_medium_default,
		"../../content/vanilla/buildings/commercial_offices.json": commercial_offices_default,
		"../../content/vanilla/buildings/commercial_plaza.json": commercial_plaza_default,
		"../../content/vanilla/buildings/commercial_row.json": commercial_row_default,
		"../../content/vanilla/buildings/commercial_small.json": commercial_small_default,
		"../../content/vanilla/buildings/commercial_tower.json": commercial_tower_default,
		"../../content/vanilla/buildings/community_centre.json": community_centre_default$1,
		"../../content/vanilla/buildings/fire_station.json": fire_station_default$1,
		"../../content/vanilla/buildings/fire_station_large.json": fire_station_large_default$1,
		"../../content/vanilla/buildings/gallery.json": gallery_default$1,
		"../../content/vanilla/buildings/gas_power_plant.json": gas_power_plant_default,
		"../../content/vanilla/buildings/high_school.json": high_school_default$1,
		"../../content/vanilla/buildings/hospital.json": hospital_default$1,
		"../../content/vanilla/buildings/incinerator.json": incinerator_default$1,
		"../../content/vanilla/buildings/industrial_chemical.json": industrial_chemical_default,
		"../../content/vanilla/buildings/industrial_complex.json": industrial_complex_default,
		"../../content/vanilla/buildings/industrial_foundry.json": industrial_foundry_default,
		"../../content/vanilla/buildings/industrial_hall.json": industrial_hall_default,
		"../../content/vanilla/buildings/industrial_large.json": industrial_large_default,
		"../../content/vanilla/buildings/industrial_medium.json": industrial_medium_default,
		"../../content/vanilla/buildings/industrial_park.json": industrial_park_default,
		"../../content/vanilla/buildings/industrial_refinery.json": industrial_refinery_default,
		"../../content/vanilla/buildings/industrial_row.json": industrial_row_default,
		"../../content/vanilla/buildings/industrial_small.json": industrial_small_default,
		"../../content/vanilla/buildings/industrial_smelter.json": industrial_smelter_default,
		"../../content/vanilla/buildings/industrial_works.json": industrial_works_default,
		"../../content/vanilla/buildings/industrial_yard.json": industrial_yard_default,
		"../../content/vanilla/buildings/landfill.json": landfill_default$1,
		"../../content/vanilla/buildings/metro_station.json": metro_station_default$1,
		"../../content/vanilla/buildings/museum.json": museum_default$1,
		"../../content/vanilla/buildings/nuclear_power_plant.json": nuclear_power_plant_default,
		"../../content/vanilla/buildings/park_large.json": park_large_default$1,
		"../../content/vanilla/buildings/park_small.json": park_small_default$1,
		"../../content/vanilla/buildings/plaza.json": plaza_default,
		"../../content/vanilla/buildings/police_large.json": police_large_default$1,
		"../../content/vanilla/buildings/police_small.json": police_small_default$1,
		"../../content/vanilla/buildings/prison.json": prison_default$1,
		"../../content/vanilla/buildings/pump_station.json": pump_station_default$1,
		"../../content/vanilla/buildings/residential_court.json": residential_court_default,
		"../../content/vanilla/buildings/residential_estate.json": residential_estate_default,
		"../../content/vanilla/buildings/residential_highrise.json": residential_highrise_default,
		"../../content/vanilla/buildings/residential_large.json": residential_large_default,
		"../../content/vanilla/buildings/residential_medium.json": residential_medium_default,
		"../../content/vanilla/buildings/residential_quarter.json": residential_quarter_default,
		"../../content/vanilla/buildings/residential_row.json": residential_row_default,
		"../../content/vanilla/buildings/residential_skyline.json": residential_skyline_default,
		"../../content/vanilla/buildings/residential_small.json": residential_small_default,
		"../../content/vanilla/buildings/residential_spire.json": residential_spire_default,
		"../../content/vanilla/buildings/residential_terrace.json": residential_terrace_default,
		"../../content/vanilla/buildings/residential_terraces.json": residential_terraces_default,
		"../../content/vanilla/buildings/residential_tower.json": residential_tower_default,
		"../../content/vanilla/buildings/retirement_home.json": retirement_home_default$1,
		"../../content/vanilla/buildings/school.json": school_default$1,
		"../../content/vanilla/buildings/theatre.json": theatre_default$1,
		"../../content/vanilla/buildings/tram_stop.json": tram_stop_default$1,
		"../../content/vanilla/buildings/transit_depot.json": transit_depot_default$1,
		"../../content/vanilla/buildings/transit_stop.json": transit_stop_default$1,
		"../../content/vanilla/buildings/university.json": university_default$2,
		"../../content/vanilla/buildings/water_treatment.json": water_treatment_default$1,
		"../../content/vanilla/buildings/water_works.json": water_works_default$1,
		"../../content/vanilla/buildings/wind_turbine.json": wind_turbine_default,
		"../../content/vanilla/grants/content_city.json": content_city_default,
		"../../content/vanilla/grants/first_thousand.json": first_thousand_default,
		"../../content/vanilla/grants/ten_thousand.json": ten_thousand_default,
		"../../content/vanilla/grants/university.json": university_default$1,
		"../../content/vanilla/locale/cs.json": cs_default,
		"../../content/vanilla/locale/en.json": en_default,
		"../../content/vanilla/manifest.json": manifest_default,
		"../../content/vanilla/sprites/index.json": sprites_default,
		"../../content/vanilla/tiles/index.json": tiles_default
	});
	const iconFiles = /* #__PURE__ */ Object.assign({
		"../../content/vanilla/icons/blackout.png": blackout_default,
		"../../content/vanilla/icons/bond-issue.png": bond_issue_default,
		"../../content/vanilla/icons/budget.png": budget_default,
		"../../content/vanilla/icons/bulldoze.png": bulldoze_default,
		"../../content/vanilla/icons/chemicalSpill.png": chemicalSpill_default,
		"../../content/vanilla/icons/cinema.png": cinema_default,
		"../../content/vanilla/icons/clinic.png": clinic_default,
		"../../content/vanilla/icons/close.png": close_default,
		"../../content/vanilla/icons/coal_power_plant.png": coal_power_plant_default,
		"../../content/vanilla/icons/community_centre.png": community_centre_default,
		"../../content/vanilla/icons/coverage-culture.png": coverage_culture_default,
		"../../content/vanilla/icons/coverage-education.png": coverage_education_default,
		"../../content/vanilla/icons/coverage-fire.png": coverage_fire_default,
		"../../content/vanilla/icons/coverage-health.png": coverage_health_default,
		"../../content/vanilla/icons/coverage-parks.png": coverage_parks_default,
		"../../content/vanilla/icons/coverage-police.png": coverage_police_default,
		"../../content/vanilla/icons/coverage-waste.png": coverage_waste_default,
		"../../content/vanilla/icons/disasters-toggle.png": disasters_toggle_default,
		"../../content/vanilla/icons/disasters.png": disasters_default,
		"../../content/vanilla/icons/download.png": download_default,
		"../../content/vanilla/icons/earthquake.png": earthquake_default,
		"../../content/vanilla/icons/epidemic.png": epidemic_default,
		"../../content/vanilla/icons/explosion.png": explosion_default,
		"../../content/vanilla/icons/fare.png": fare_default,
		"../../content/vanilla/icons/fire.png": fire_default,
		"../../content/vanilla/icons/fire_station.png": fire_station_default,
		"../../content/vanilla/icons/fire_station_large.png": fire_station_large_default,
		"../../content/vanilla/icons/flood.png": flood_default,
		"../../content/vanilla/icons/funding.png": funding_default,
		"../../content/vanilla/icons/gallery.png": gallery_default,
		"../../content/vanilla/icons/gangWar.png": gangWar_default,
		"../../content/vanilla/icons/high_school.png": high_school_default,
		"../../content/vanilla/icons/hospital.png": hospital_default,
		"../../content/vanilla/icons/incinerator.png": incinerator_default,
		"../../content/vanilla/icons/industrialAccident.png": industrialAccident_default,
		"../../content/vanilla/icons/landfill.png": landfill_default,
		"../../content/vanilla/icons/landslide.png": landslide_default,
		"../../content/vanilla/icons/language.png": language_default,
		"../../content/vanilla/icons/layer-crime.png": layer_crime_default,
		"../../content/vanilla/icons/layer-happiness.png": layer_happiness_default,
		"../../content/vanilla/icons/layer-landvalue.png": layer_landvalue_default,
		"../../content/vanilla/icons/layer-none.png": layer_none_default,
		"../../content/vanilla/icons/layer-pollution.png": layer_pollution_default,
		"../../content/vanilla/icons/layer-power.png": layer_power_default,
		"../../content/vanilla/icons/layer-traffic.png": layer_traffic_default,
		"../../content/vanilla/icons/layers.png": layers_default,
		"../../content/vanilla/icons/line-create.png": line_create_default,
		"../../content/vanilla/icons/line-delete.png": line_delete_default,
		"../../content/vanilla/icons/loan-repay.png": loan_repay_default,
		"../../content/vanilla/icons/loan-take.png": loan_take_default,
		"../../content/vanilla/icons/map-size.png": map_size_default,
		"../../content/vanilla/icons/metro_station.png": metro_station_default,
		"../../content/vanilla/icons/museum.png": museum_default,
		"../../content/vanilla/icons/open-file.png": open_file_default,
		"../../content/vanilla/icons/park_large.png": park_large_default,
		"../../content/vanilla/icons/park_small.png": park_small_default,
		"../../content/vanilla/icons/pileup.png": pileup_default,
		"../../content/vanilla/icons/pipe.png": pipe_default,
		"../../content/vanilla/icons/police_large.png": police_large_default,
		"../../content/vanilla/icons/police_small.png": police_small_default,
		"../../content/vanilla/icons/prison.png": prison_default,
		"../../content/vanilla/icons/pump_station.png": pump_station_default,
		"../../content/vanilla/icons/quickload.png": quickload_default,
		"../../content/vanilla/icons/quicksave.png": quicksave_default,
		"../../content/vanilla/icons/reroll.png": reroll_default,
		"../../content/vanilla/icons/resume.png": resume_default,
		"../../content/vanilla/icons/retirement_home.png": retirement_home_default,
		"../../content/vanilla/icons/riot.png": riot_default,
		"../../content/vanilla/icons/road-avenue.png": road_avenue_default,
		"../../content/vanilla/icons/road-highway.png": road_highway_default,
		"../../content/vanilla/icons/road-street.png": road_street_default,
		"../../content/vanilla/icons/save.png": save_default,
		"../../content/vanilla/icons/school.png": school_default,
		"../../content/vanilla/icons/speed-1.png": speed_1_default,
		"../../content/vanilla/icons/speed-2.png": speed_2_default,
		"../../content/vanilla/icons/speed-3.png": speed_3_default,
		"../../content/vanilla/icons/speed-4.png": speed_4_default,
		"../../content/vanilla/icons/speed-pause.png": speed_pause_default,
		"../../content/vanilla/icons/start-city.png": start_city_default,
		"../../content/vanilla/icons/stop-add.png": stop_add_default,
		"../../content/vanilla/icons/stop-remove.png": stop_remove_default,
		"../../content/vanilla/icons/strike.png": strike_default,
		"../../content/vanilla/icons/tax-decrease.png": tax_decrease_default,
		"../../content/vanilla/icons/tax-increase.png": tax_increase_default,
		"../../content/vanilla/icons/taxes.png": taxes_default,
		"../../content/vanilla/icons/terrain-fill.png": terrain_fill_default,
		"../../content/vanilla/icons/terrain-level.png": terrain_level_default,
		"../../content/vanilla/icons/terrain-lower.png": terrain_lower_default,
		"../../content/vanilla/icons/terrain-raise.png": terrain_raise_default,
		"../../content/vanilla/icons/theatre.png": theatre_default,
		"../../content/vanilla/icons/tornado.png": tornado_default,
		"../../content/vanilla/icons/tram_stop.png": tram_stop_default,
		"../../content/vanilla/icons/transit_depot.png": transit_depot_default,
		"../../content/vanilla/icons/transit_stop.png": transit_stop_default,
		"../../content/vanilla/icons/university.png": university_default,
		"../../content/vanilla/icons/vehicles.png": vehicles_default,
		"../../content/vanilla/icons/view-ghost.png": view_ghost_default,
		"../../content/vanilla/icons/view-surface.png": view_surface_default,
		"../../content/vanilla/icons/view-underground.png": view_underground_default,
		"../../content/vanilla/icons/water_treatment.png": water_treatment_default,
		"../../content/vanilla/icons/water_works.png": water_works_default,
		"../../content/vanilla/icons/wildfire.png": wildfire_default,
		"../../content/vanilla/icons/zone-clear.png": zone_clear_default,
		"../../content/vanilla/icons/zone-commercial.png": zone_commercial_default,
		"../../content/vanilla/icons/zone-industrial.png": zone_industrial_default,
		"../../content/vanilla/icons/zone-residential.png": zone_residential_default
	});
	const icons = {};
	for (const absolute of Object.keys(iconFiles).sort()) {
		const name = relativePath(absolute).slice(6).replace(/\.png$/, "");
		icons[name] = iconFiles[absolute];
	}
	const spriteFiles = /* #__PURE__ */ Object.assign({
		"../../content/vanilla/sprites/boulders__a.png": boulders__a_default,
		"../../content/vanilla/sprites/boulders__b.png": boulders__b_default,
		"../../content/vanilla/sprites/boulders__c.png": boulders__c_default,
		"../../content/vanilla/sprites/cinema__a.png": cinema__a_default,
		"../../content/vanilla/sprites/cinema__b.png": cinema__b_default,
		"../../content/vanilla/sprites/cinema__c.png": cinema__c_default,
		"../../content/vanilla/sprites/city_park__a.png": city_park__a_default,
		"../../content/vanilla/sprites/city_park__b.png": city_park__b_default,
		"../../content/vanilla/sprites/city_park__c.png": city_park__c_default,
		"../../content/vanilla/sprites/clinic__a.png": clinic__a_default,
		"../../content/vanilla/sprites/clinic__b.png": clinic__b_default,
		"../../content/vanilla/sprites/clinic__c.png": clinic__c_default,
		"../../content/vanilla/sprites/coal_power_plant__a.png": coal_power_plant__a_default,
		"../../content/vanilla/sprites/coal_power_plant__b.png": coal_power_plant__b_default,
		"../../content/vanilla/sprites/coal_power_plant__c.png": coal_power_plant__c_default,
		"../../content/vanilla/sprites/commercial_arcade__a.png": commercial_arcade__a_default,
		"../../content/vanilla/sprites/commercial_arcade__b.png": commercial_arcade__b_default,
		"../../content/vanilla/sprites/commercial_arcade__c.png": commercial_arcade__c_default,
		"../../content/vanilla/sprites/commercial_centre__a.png": commercial_centre__a_default,
		"../../content/vanilla/sprites/commercial_centre__b.png": commercial_centre__b_default,
		"../../content/vanilla/sprites/commercial_centre__c.png": commercial_centre__c_default,
		"../../content/vanilla/sprites/commercial_downtown__a.png": commercial_downtown__a_default,
		"../../content/vanilla/sprites/commercial_downtown__b.png": commercial_downtown__b_default,
		"../../content/vanilla/sprites/commercial_downtown__c.png": commercial_downtown__c_default,
		"../../content/vanilla/sprites/commercial_gallery__a.png": commercial_gallery__a_default,
		"../../content/vanilla/sprites/commercial_gallery__b.png": commercial_gallery__b_default,
		"../../content/vanilla/sprites/commercial_gallery__c.png": commercial_gallery__c_default,
		"../../content/vanilla/sprites/commercial_highrise__a.png": commercial_highrise__a_default,
		"../../content/vanilla/sprites/commercial_highrise__b.png": commercial_highrise__b_default,
		"../../content/vanilla/sprites/commercial_highrise__c.png": commercial_highrise__c_default,
		"../../content/vanilla/sprites/commercial_large__a.png": commercial_large__a_default,
		"../../content/vanilla/sprites/commercial_large__b.png": commercial_large__b_default,
		"../../content/vanilla/sprites/commercial_large__c.png": commercial_large__c_default,
		"../../content/vanilla/sprites/commercial_mall__a.png": commercial_mall__a_default,
		"../../content/vanilla/sprites/commercial_mall__b.png": commercial_mall__b_default,
		"../../content/vanilla/sprites/commercial_mall__c.png": commercial_mall__c_default,
		"../../content/vanilla/sprites/commercial_medium__a.png": commercial_medium__a_default,
		"../../content/vanilla/sprites/commercial_medium__b.png": commercial_medium__b_default,
		"../../content/vanilla/sprites/commercial_medium__c.png": commercial_medium__c_default,
		"../../content/vanilla/sprites/commercial_offices__a.png": commercial_offices__a_default,
		"../../content/vanilla/sprites/commercial_offices__b.png": commercial_offices__b_default,
		"../../content/vanilla/sprites/commercial_offices__c.png": commercial_offices__c_default,
		"../../content/vanilla/sprites/commercial_plaza__a.png": commercial_plaza__a_default,
		"../../content/vanilla/sprites/commercial_plaza__b.png": commercial_plaza__b_default,
		"../../content/vanilla/sprites/commercial_plaza__c.png": commercial_plaza__c_default,
		"../../content/vanilla/sprites/commercial_row__a.png": commercial_row__a_default,
		"../../content/vanilla/sprites/commercial_row__b.png": commercial_row__b_default,
		"../../content/vanilla/sprites/commercial_row__c.png": commercial_row__c_default,
		"../../content/vanilla/sprites/commercial_small__a.png": commercial_small__a_default,
		"../../content/vanilla/sprites/commercial_small__b.png": commercial_small__b_default,
		"../../content/vanilla/sprites/commercial_small__c.png": commercial_small__c_default,
		"../../content/vanilla/sprites/commercial_tower__a.png": commercial_tower__a_default,
		"../../content/vanilla/sprites/commercial_tower__b.png": commercial_tower__b_default,
		"../../content/vanilla/sprites/commercial_tower__c.png": commercial_tower__c_default,
		"../../content/vanilla/sprites/community_centre__a.png": community_centre__a_default,
		"../../content/vanilla/sprites/community_centre__b.png": community_centre__b_default,
		"../../content/vanilla/sprites/community_centre__c.png": community_centre__c_default,
		"../../content/vanilla/sprites/fire_station__a.png": fire_station__a_default,
		"../../content/vanilla/sprites/fire_station__b.png": fire_station__b_default,
		"../../content/vanilla/sprites/fire_station__c.png": fire_station__c_default,
		"../../content/vanilla/sprites/fire_station_large__a.png": fire_station_large__a_default,
		"../../content/vanilla/sprites/fire_station_large__b.png": fire_station_large__b_default,
		"../../content/vanilla/sprites/fire_station_large__c.png": fire_station_large__c_default,
		"../../content/vanilla/sprites/forest_clump__a.png": forest_clump__a_default,
		"../../content/vanilla/sprites/forest_clump__b.png": forest_clump__b_default,
		"../../content/vanilla/sprites/forest_clump__c.png": forest_clump__c_default,
		"../../content/vanilla/sprites/gallery__a.png": gallery__a_default,
		"../../content/vanilla/sprites/gallery__b.png": gallery__b_default,
		"../../content/vanilla/sprites/gallery__c.png": gallery__c_default,
		"../../content/vanilla/sprites/gas_power_plant__a.png": gas_power_plant__a_default,
		"../../content/vanilla/sprites/gas_power_plant__b.png": gas_power_plant__b_default,
		"../../content/vanilla/sprites/gas_power_plant__c.png": gas_power_plant__c_default,
		"../../content/vanilla/sprites/high_school__a.png": high_school__a_default,
		"../../content/vanilla/sprites/high_school__b.png": high_school__b_default,
		"../../content/vanilla/sprites/high_school__c.png": high_school__c_default,
		"../../content/vanilla/sprites/hospital__a.png": hospital__a_default,
		"../../content/vanilla/sprites/hospital__b.png": hospital__b_default,
		"../../content/vanilla/sprites/hospital__c.png": hospital__c_default,
		"../../content/vanilla/sprites/incinerator__a.png": incinerator__a_default,
		"../../content/vanilla/sprites/incinerator__b.png": incinerator__b_default,
		"../../content/vanilla/sprites/incinerator__c.png": incinerator__c_default,
		"../../content/vanilla/sprites/industrial_chemical__a.png": industrial_chemical__a_default,
		"../../content/vanilla/sprites/industrial_chemical__b.png": industrial_chemical__b_default,
		"../../content/vanilla/sprites/industrial_chemical__c.png": industrial_chemical__c_default,
		"../../content/vanilla/sprites/industrial_complex__a.png": industrial_complex__a_default,
		"../../content/vanilla/sprites/industrial_complex__b.png": industrial_complex__b_default,
		"../../content/vanilla/sprites/industrial_complex__c.png": industrial_complex__c_default,
		"../../content/vanilla/sprites/industrial_foundry__a.png": industrial_foundry__a_default,
		"../../content/vanilla/sprites/industrial_foundry__b.png": industrial_foundry__b_default,
		"../../content/vanilla/sprites/industrial_foundry__c.png": industrial_foundry__c_default,
		"../../content/vanilla/sprites/industrial_hall__a.png": industrial_hall__a_default,
		"../../content/vanilla/sprites/industrial_hall__b.png": industrial_hall__b_default,
		"../../content/vanilla/sprites/industrial_hall__c.png": industrial_hall__c_default,
		"../../content/vanilla/sprites/industrial_large__a.png": industrial_large__a_default,
		"../../content/vanilla/sprites/industrial_large__b.png": industrial_large__b_default,
		"../../content/vanilla/sprites/industrial_large__c.png": industrial_large__c_default,
		"../../content/vanilla/sprites/industrial_medium__a.png": industrial_medium__a_default,
		"../../content/vanilla/sprites/industrial_medium__b.png": industrial_medium__b_default,
		"../../content/vanilla/sprites/industrial_medium__c.png": industrial_medium__c_default,
		"../../content/vanilla/sprites/industrial_park__a.png": industrial_park__a_default,
		"../../content/vanilla/sprites/industrial_park__b.png": industrial_park__b_default,
		"../../content/vanilla/sprites/industrial_park__c.png": industrial_park__c_default,
		"../../content/vanilla/sprites/industrial_refinery__a.png": industrial_refinery__a_default,
		"../../content/vanilla/sprites/industrial_refinery__b.png": industrial_refinery__b_default,
		"../../content/vanilla/sprites/industrial_refinery__c.png": industrial_refinery__c_default,
		"../../content/vanilla/sprites/industrial_row__a.png": industrial_row__a_default,
		"../../content/vanilla/sprites/industrial_row__b.png": industrial_row__b_default,
		"../../content/vanilla/sprites/industrial_row__c.png": industrial_row__c_default,
		"../../content/vanilla/sprites/industrial_small__a.png": industrial_small__a_default,
		"../../content/vanilla/sprites/industrial_small__b.png": industrial_small__b_default,
		"../../content/vanilla/sprites/industrial_small__c.png": industrial_small__c_default,
		"../../content/vanilla/sprites/industrial_smelter__a.png": industrial_smelter__a_default,
		"../../content/vanilla/sprites/industrial_smelter__b.png": industrial_smelter__b_default,
		"../../content/vanilla/sprites/industrial_smelter__c.png": industrial_smelter__c_default,
		"../../content/vanilla/sprites/industrial_works__a.png": industrial_works__a_default,
		"../../content/vanilla/sprites/industrial_works__b.png": industrial_works__b_default,
		"../../content/vanilla/sprites/industrial_works__c.png": industrial_works__c_default,
		"../../content/vanilla/sprites/industrial_yard__a.png": industrial_yard__a_default,
		"../../content/vanilla/sprites/industrial_yard__b.png": industrial_yard__b_default,
		"../../content/vanilla/sprites/industrial_yard__c.png": industrial_yard__c_default,
		"../../content/vanilla/sprites/landfill__a.png": landfill__a_default,
		"../../content/vanilla/sprites/landfill__b.png": landfill__b_default,
		"../../content/vanilla/sprites/landfill__c.png": landfill__c_default,
		"../../content/vanilla/sprites/metro_station__a.png": metro_station__a_default,
		"../../content/vanilla/sprites/metro_station__b.png": metro_station__b_default,
		"../../content/vanilla/sprites/metro_station__c.png": metro_station__c_default,
		"../../content/vanilla/sprites/museum__a.png": museum__a_default,
		"../../content/vanilla/sprites/museum__b.png": museum__b_default,
		"../../content/vanilla/sprites/museum__c.png": museum__c_default,
		"../../content/vanilla/sprites/nuclear_power_plant__a.png": nuclear_power_plant__a_default,
		"../../content/vanilla/sprites/nuclear_power_plant__b.png": nuclear_power_plant__b_default,
		"../../content/vanilla/sprites/nuclear_power_plant__c.png": nuclear_power_plant__c_default,
		"../../content/vanilla/sprites/park_large__a.png": park_large__a_default,
		"../../content/vanilla/sprites/park_large__b.png": park_large__b_default,
		"../../content/vanilla/sprites/park_large__c.png": park_large__c_default,
		"../../content/vanilla/sprites/park_small__a.png": park_small__a_default,
		"../../content/vanilla/sprites/park_small__b.png": park_small__b_default,
		"../../content/vanilla/sprites/park_small__c.png": park_small__c_default,
		"../../content/vanilla/sprites/plaza__a.png": plaza__a_default,
		"../../content/vanilla/sprites/plaza__b.png": plaza__b_default,
		"../../content/vanilla/sprites/plaza__c.png": plaza__c_default,
		"../../content/vanilla/sprites/police_large__a.png": police_large__a_default,
		"../../content/vanilla/sprites/police_large__b.png": police_large__b_default,
		"../../content/vanilla/sprites/police_large__c.png": police_large__c_default,
		"../../content/vanilla/sprites/police_small__a.png": police_small__a_default,
		"../../content/vanilla/sprites/police_small__b.png": police_small__b_default,
		"../../content/vanilla/sprites/police_small__c.png": police_small__c_default,
		"../../content/vanilla/sprites/prison__a.png": prison__a_default,
		"../../content/vanilla/sprites/prison__b.png": prison__b_default,
		"../../content/vanilla/sprites/prison__c.png": prison__c_default,
		"../../content/vanilla/sprites/pump_station__a.png": pump_station__a_default,
		"../../content/vanilla/sprites/pump_station__b.png": pump_station__b_default,
		"../../content/vanilla/sprites/pump_station__c.png": pump_station__c_default,
		"../../content/vanilla/sprites/residential_court__a.png": residential_court__a_default,
		"../../content/vanilla/sprites/residential_court__b.png": residential_court__b_default,
		"../../content/vanilla/sprites/residential_court__c.png": residential_court__c_default,
		"../../content/vanilla/sprites/residential_estate__a.png": residential_estate__a_default,
		"../../content/vanilla/sprites/residential_estate__b.png": residential_estate__b_default,
		"../../content/vanilla/sprites/residential_estate__c.png": residential_estate__c_default,
		"../../content/vanilla/sprites/residential_highrise__a.png": residential_highrise__a_default,
		"../../content/vanilla/sprites/residential_highrise__b.png": residential_highrise__b_default,
		"../../content/vanilla/sprites/residential_highrise__c.png": residential_highrise__c_default,
		"../../content/vanilla/sprites/residential_large__a.png": residential_large__a_default,
		"../../content/vanilla/sprites/residential_large__b.png": residential_large__b_default,
		"../../content/vanilla/sprites/residential_large__c.png": residential_large__c_default,
		"../../content/vanilla/sprites/residential_medium__a.png": residential_medium__a_default,
		"../../content/vanilla/sprites/residential_medium__b.png": residential_medium__b_default,
		"../../content/vanilla/sprites/residential_medium__c.png": residential_medium__c_default,
		"../../content/vanilla/sprites/residential_quarter__a.png": residential_quarter__a_default,
		"../../content/vanilla/sprites/residential_quarter__b.png": residential_quarter__b_default,
		"../../content/vanilla/sprites/residential_quarter__c.png": residential_quarter__c_default,
		"../../content/vanilla/sprites/residential_row__a.png": residential_row__a_default,
		"../../content/vanilla/sprites/residential_row__b.png": residential_row__b_default,
		"../../content/vanilla/sprites/residential_row__c.png": residential_row__c_default,
		"../../content/vanilla/sprites/residential_skyline__a.png": residential_skyline__a_default,
		"../../content/vanilla/sprites/residential_skyline__b.png": residential_skyline__b_default,
		"../../content/vanilla/sprites/residential_skyline__c.png": residential_skyline__c_default,
		"../../content/vanilla/sprites/residential_small__a.png": residential_small__a_default,
		"../../content/vanilla/sprites/residential_small__b.png": residential_small__b_default,
		"../../content/vanilla/sprites/residential_small__c.png": residential_small__c_default,
		"../../content/vanilla/sprites/residential_spire__a.png": residential_spire__a_default,
		"../../content/vanilla/sprites/residential_spire__b.png": residential_spire__b_default,
		"../../content/vanilla/sprites/residential_spire__c.png": residential_spire__c_default,
		"../../content/vanilla/sprites/residential_terrace__a.png": residential_terrace__a_default,
		"../../content/vanilla/sprites/residential_terrace__b.png": residential_terrace__b_default,
		"../../content/vanilla/sprites/residential_terrace__c.png": residential_terrace__c_default,
		"../../content/vanilla/sprites/residential_terraces__a.png": residential_terraces__a_default,
		"../../content/vanilla/sprites/residential_terraces__b.png": residential_terraces__b_default,
		"../../content/vanilla/sprites/residential_terraces__c.png": residential_terraces__c_default,
		"../../content/vanilla/sprites/residential_tower__a.png": residential_tower__a_default,
		"../../content/vanilla/sprites/residential_tower__b.png": residential_tower__b_default,
		"../../content/vanilla/sprites/residential_tower__c.png": residential_tower__c_default,
		"../../content/vanilla/sprites/retirement_home__a.png": retirement_home__a_default,
		"../../content/vanilla/sprites/retirement_home__b.png": retirement_home__b_default,
		"../../content/vanilla/sprites/retirement_home__c.png": retirement_home__c_default,
		"../../content/vanilla/sprites/ruin_1x1__a.png": ruin_1x1__a_default,
		"../../content/vanilla/sprites/ruin_1x1__b.png": ruin_1x1__b_default,
		"../../content/vanilla/sprites/ruin_1x1__c.png": ruin_1x1__c_default,
		"../../content/vanilla/sprites/ruin_2x2__a.png": ruin_2x2__a_default,
		"../../content/vanilla/sprites/ruin_2x2__b.png": ruin_2x2__b_default,
		"../../content/vanilla/sprites/ruin_2x2__c.png": ruin_2x2__c_default,
		"../../content/vanilla/sprites/ruin_3x3__a.png": ruin_3x3__a_default,
		"../../content/vanilla/sprites/ruin_3x3__b.png": ruin_3x3__b_default,
		"../../content/vanilla/sprites/ruin_3x3__c.png": ruin_3x3__c_default,
		"../../content/vanilla/sprites/ruin_4x4__a.png": ruin_4x4__a_default,
		"../../content/vanilla/sprites/ruin_4x4__b.png": ruin_4x4__b_default,
		"../../content/vanilla/sprites/ruin_4x4__c.png": ruin_4x4__c_default,
		"../../content/vanilla/sprites/school__a.png": school__a_default,
		"../../content/vanilla/sprites/school__b.png": school__b_default,
		"../../content/vanilla/sprites/school__c.png": school__c_default,
		"../../content/vanilla/sprites/theatre__a.png": theatre__a_default,
		"../../content/vanilla/sprites/theatre__b.png": theatre__b_default,
		"../../content/vanilla/sprites/theatre__c.png": theatre__c_default,
		"../../content/vanilla/sprites/tram_stop__a.png": tram_stop__a_default,
		"../../content/vanilla/sprites/tram_stop__b.png": tram_stop__b_default,
		"../../content/vanilla/sprites/tram_stop__c.png": tram_stop__c_default,
		"../../content/vanilla/sprites/transit_depot__a.png": transit_depot__a_default,
		"../../content/vanilla/sprites/transit_depot__b.png": transit_depot__b_default,
		"../../content/vanilla/sprites/transit_depot__c.png": transit_depot__c_default,
		"../../content/vanilla/sprites/transit_stop__a.png": transit_stop__a_default,
		"../../content/vanilla/sprites/transit_stop__b.png": transit_stop__b_default,
		"../../content/vanilla/sprites/transit_stop__c.png": transit_stop__c_default,
		"../../content/vanilla/sprites/university__a.png": university__a_default,
		"../../content/vanilla/sprites/university__b.png": university__b_default,
		"../../content/vanilla/sprites/university__c.png": university__c_default,
		"../../content/vanilla/sprites/water_treatment__a.png": water_treatment__a_default,
		"../../content/vanilla/sprites/water_treatment__b.png": water_treatment__b_default,
		"../../content/vanilla/sprites/water_treatment__c.png": water_treatment__c_default,
		"../../content/vanilla/sprites/water_works__a.png": water_works__a_default,
		"../../content/vanilla/sprites/water_works__b.png": water_works__b_default,
		"../../content/vanilla/sprites/water_works__c.png": water_works__c_default,
		"../../content/vanilla/sprites/wind_turbine__a.png": wind_turbine__a_default,
		"../../content/vanilla/sprites/wind_turbine__b.png": wind_turbine__b_default,
		"../../content/vanilla/sprites/wind_turbine__c.png": wind_turbine__c_default
	});
	const spriteUrls = {};
	for (const absolute of Object.keys(spriteFiles).sort()) {
		const name = relativePath(absolute).slice(8).replace(/\.png$/, "");
		spriteUrls[name] = spriteFiles[absolute];
	}
	const SURFACES = /* @__PURE__ */ new Set([
		"grass",
		"water",
		"sand",
		"rock",
		"forest",
		"marsh",
		"asphalt_street",
		"asphalt_avenue",
		"asphalt_highway"
	]);
	const tileFiles = /* #__PURE__ */ Object.assign({
		"../../content/vanilla/tiles/asphalt_avenue__a.png": asphalt_avenue__a_default,
		"../../content/vanilla/tiles/asphalt_highway__a.png": asphalt_highway__a_default,
		"../../content/vanilla/tiles/asphalt_street__a.png": asphalt_street__a_default,
		"../../content/vanilla/tiles/avenue__0.png": avenue__0_default,
		"../../content/vanilla/tiles/avenue__e.png": avenue__e_default,
		"../../content/vanilla/tiles/avenue__es.png": avenue__es_default,
		"../../content/vanilla/tiles/avenue__esw.png": avenue__esw_default,
		"../../content/vanilla/tiles/avenue__ew.png": avenue__ew_default,
		"../../content/vanilla/tiles/avenue__n.png": avenue__n_default,
		"../../content/vanilla/tiles/avenue__ne.png": avenue__ne_default,
		"../../content/vanilla/tiles/avenue__nes.png": avenue__nes_default,
		"../../content/vanilla/tiles/avenue__nesw.png": avenue__nesw_default,
		"../../content/vanilla/tiles/avenue__new.png": avenue__new_default,
		"../../content/vanilla/tiles/avenue__ns.png": avenue__ns_default,
		"../../content/vanilla/tiles/avenue__nsw.png": avenue__nsw_default,
		"../../content/vanilla/tiles/avenue__nw.png": avenue__nw_default,
		"../../content/vanilla/tiles/avenue__s.png": avenue__s_default,
		"../../content/vanilla/tiles/avenue__sw.png": avenue__sw_default,
		"../../content/vanilla/tiles/avenue__w.png": avenue__w_default,
		"../../content/vanilla/tiles/forest__a.png": forest__a_default,
		"../../content/vanilla/tiles/forest__b.png": forest__b_default,
		"../../content/vanilla/tiles/forest__c.png": forest__c_default,
		"../../content/vanilla/tiles/grass__a.png": grass__a_default,
		"../../content/vanilla/tiles/grass__b.png": grass__b_default,
		"../../content/vanilla/tiles/grass__c.png": grass__c_default,
		"../../content/vanilla/tiles/highway__0.png": highway__0_default,
		"../../content/vanilla/tiles/highway__e.png": highway__e_default,
		"../../content/vanilla/tiles/highway__es.png": highway__es_default,
		"../../content/vanilla/tiles/highway__esw.png": highway__esw_default,
		"../../content/vanilla/tiles/highway__ew.png": highway__ew_default,
		"../../content/vanilla/tiles/highway__n.png": highway__n_default,
		"../../content/vanilla/tiles/highway__ne.png": highway__ne_default,
		"../../content/vanilla/tiles/highway__nes.png": highway__nes_default,
		"../../content/vanilla/tiles/highway__nesw.png": highway__nesw_default,
		"../../content/vanilla/tiles/highway__new.png": highway__new_default,
		"../../content/vanilla/tiles/highway__ns.png": highway__ns_default,
		"../../content/vanilla/tiles/highway__nsw.png": highway__nsw_default,
		"../../content/vanilla/tiles/highway__nw.png": highway__nw_default,
		"../../content/vanilla/tiles/highway__s.png": highway__s_default,
		"../../content/vanilla/tiles/highway__sw.png": highway__sw_default,
		"../../content/vanilla/tiles/highway__w.png": highway__w_default,
		"../../content/vanilla/tiles/marsh__a.png": marsh__a_default,
		"../../content/vanilla/tiles/marsh__b.png": marsh__b_default,
		"../../content/vanilla/tiles/marsh__c.png": marsh__c_default,
		"../../content/vanilla/tiles/pipe__0.png": pipe__0_default,
		"../../content/vanilla/tiles/pipe__a.png": pipe__a_default,
		"../../content/vanilla/tiles/pipe__e.png": pipe__e_default,
		"../../content/vanilla/tiles/pipe__es.png": pipe__es_default,
		"../../content/vanilla/tiles/pipe__esw.png": pipe__esw_default,
		"../../content/vanilla/tiles/pipe__ew.png": pipe__ew_default,
		"../../content/vanilla/tiles/pipe__n.png": pipe__n_default,
		"../../content/vanilla/tiles/pipe__ne.png": pipe__ne_default,
		"../../content/vanilla/tiles/pipe__nes.png": pipe__nes_default,
		"../../content/vanilla/tiles/pipe__nesw.png": pipe__nesw_default,
		"../../content/vanilla/tiles/pipe__new.png": pipe__new_default,
		"../../content/vanilla/tiles/pipe__ns.png": pipe__ns_default,
		"../../content/vanilla/tiles/pipe__nsw.png": pipe__nsw_default,
		"../../content/vanilla/tiles/pipe__nw.png": pipe__nw_default,
		"../../content/vanilla/tiles/pipe__s.png": pipe__s_default,
		"../../content/vanilla/tiles/pipe__sw.png": pipe__sw_default,
		"../../content/vanilla/tiles/pipe__w.png": pipe__w_default,
		"../../content/vanilla/tiles/rock__a.png": rock__a_default,
		"../../content/vanilla/tiles/rock__b.png": rock__b_default,
		"../../content/vanilla/tiles/rock__c.png": rock__c_default,
		"../../content/vanilla/tiles/sand__a.png": sand__a_default,
		"../../content/vanilla/tiles/sand__b.png": sand__b_default,
		"../../content/vanilla/tiles/sand__c.png": sand__c_default,
		"../../content/vanilla/tiles/street__0.png": street__0_default,
		"../../content/vanilla/tiles/street__e.png": street__e_default,
		"../../content/vanilla/tiles/street__es.png": street__es_default,
		"../../content/vanilla/tiles/street__esw.png": street__esw_default,
		"../../content/vanilla/tiles/street__ew.png": street__ew_default,
		"../../content/vanilla/tiles/street__n.png": street__n_default,
		"../../content/vanilla/tiles/street__ne.png": street__ne_default,
		"../../content/vanilla/tiles/street__nes.png": street__nes_default,
		"../../content/vanilla/tiles/street__nesw.png": street__nesw_default,
		"../../content/vanilla/tiles/street__new.png": street__new_default,
		"../../content/vanilla/tiles/street__ns.png": street__ns_default,
		"../../content/vanilla/tiles/street__nsw.png": street__nsw_default,
		"../../content/vanilla/tiles/street__nw.png": street__nw_default,
		"../../content/vanilla/tiles/street__s.png": street__s_default,
		"../../content/vanilla/tiles/street__sw.png": street__sw_default,
		"../../content/vanilla/tiles/street__w.png": street__w_default,
		"../../content/vanilla/tiles/water__a.png": water__a_default,
		"../../content/vanilla/tiles/water__b.png": water__b_default,
		"../../content/vanilla/tiles/water__c.png": water__c_default
	});
	const tiles = {};
	for (const absolute of Object.keys(tileFiles).sort()) {
		const [terrain, variant] = relativePath(absolute).slice(6).replace(/\.png$/, "").split("__");
		if (terrain === void 0 || variant === void 0 || !SURFACES.has(terrain)) continue;
		tiles[`${terrain}|${variant}`] = tileFiles[absolute];
	}
	let manifest = void 0;
	let spriteIndex = void 0;
	let balance = void 0;
	const definitions = [];
	const locales = {};
	for (const absolute of Object.keys(modules).sort()) {
		const path = relativePath(absolute);
		const data = modules[absolute];
		if (path === "manifest.json") manifest = data;
		else if (path === "sprites/index.json") spriteIndex = data;
		else if (path === "balance.json") balance = data;
		else if (path.startsWith("buildings/") || path.startsWith("grants/")) definitions.push({
			path,
			data
		});
		else if (path.startsWith("locale/")) locales[path.slice(7).replace(/\.json$/, "")] = data;
	}
	return {
		label: SOURCE_ROOT.replace(/\/$/, ""),
		manifest,
		balance,
		definitions,
		locales,
		icons,
		sprites: buildSprites(spriteIndex, spriteUrls),
		tiles
	};
}
/**
* Spáruje záznamy z manifestu s URL obrázků.
*
* Záznam bez obrázku se **zahodí potichu**: manifest se generuje ze složky,
* takže rozejít se může jen tak, že někdo obrázek smazal a skript nepustil —
* a to nemá být důvod, proč hra nenaběhne.
*/
function buildSprites(index, urls) {
	const out = {};
	if (typeof index !== "object" || index === null) return out;
	const { scale, sprites } = index;
	if (!Array.isArray(sprites) || typeof scale !== "number" || scale <= 0) return out;
	for (const raw of sprites) {
		const entry = raw;
		const file = entry["file"];
		const building = entry["building"];
		const variant = entry["variant"];
		const anchor = entry["anchor"];
		if (typeof file !== "string" || typeof building !== "string" || typeof variant !== "string") continue;
		const url = urls[file.replace(/\.png$/, "")];
		if (url === void 0) continue;
		if (!Array.isArray(anchor) || anchor.length !== 2) continue;
		if (typeof entry["width"] !== "number" || typeof entry["height"] !== "number") continue;
		out[`${building}|${variant}`] = {
			url,
			width: entry["width"],
			height: entry["height"],
			anchor: [Number(anchor[0]), Number(anchor[1])],
			scale
		};
	}
	return out;
}
//#endregion
//#region src/sim/heights.ts
/**
* Výškový model terénu (§7 zadání fáze 3).
*
* Výška sedí **v rozích, ne v dlaždicích**. Dlaždice `(x, y)` má rohy
* `(x,y)`, `(x+1,y)`, `(x,y+1)` a `(x+1,y+1)`, takže mřížka rohů je o jedna
* větší v obou směrech než mřížka dlaždic. Kdyby výška patřila dlaždici, každý
* svah by byl schod a sousední dlaždice by se nikdy nedotýkaly.
*
* **Invariant: sousední rohy se smí lišit nejvýš o 1.** Vynucuje se kaskádou —
* zvednutí rohu automaticky zvedne sousedy, kteří by jinak invariant porušili.
* Bez něj by šlo vytvořit svislou stěnu, kterou by renderer neuměl nakreslit
* a picking trefit.
*
* Invariant se schválně týká jen **kolmých** sousedů, ne úhlopříčných. Rohy
* jedné dlaždice se tím pádem můžou lišit až o dva a vznikne „zkroucená"
* dlaždice tvaru sedla. Zadání s ní počítá: silnice ji nepobere, ale existovat
* smí, jinak by terén ztuhl do samých teras.
*/
/** Mřížka rohů je o jedna větší než mřížka dlaždic. */
/**
* Mřížka rohů je o jedna větší než mřížka dlaždic (R8 fáze 3) — výška patří
* rohu, ne dlaždici. `size` je hrana **mapy**.
*/
function cornerSizeOf(size) {
	return size + 1;
}
function cornerCellsOf(size) {
	const side = cornerSizeOf(size);
	return side * side;
}
/**
* Hrana mřížky rohů odvozená z **délky pole**.
*
* Pole tu mřížku definuje, takže hrana se z něj dá spočítat — a nemůže se s ní
* rozejít, jak by se stalo, kdyby si ji každý volající nosil zvlášť. Ušetří to
* navíc parametr v patnácti funkcích a stovkách volání.
*
* Odmocnina se pamatuje podle délky: v jednom běhu mají skoro vždy všechna
* pole stejnou velikost. Je to čistá keš klíčovaná délkou, žádný skrytý stav —
* determinismus (P2) tím netrpí.
*/
var cachedLength = -1;
var cachedSide = 0;
function cornerSideOf(heights) {
	if (heights.length !== cachedLength) {
		cachedLength = heights.length;
		cachedSide = Math.round(Math.sqrt(heights.length));
	}
	return cachedSide;
}
function cornerIndex(x, y, side) {
	return y * side + x;
}
function cornerInBounds(x, y, side) {
	return x >= 0 && y >= 0 && x < side && y < side;
}
function createCornerHeights(size) {
	return new Uint8Array(cornerCellsOf(size));
}
var NEIGHBOURS$4 = [
	[0, -1],
	[1, 0],
	[0, 1],
	[-1, 0]
];
/** Rohy dlaždice v pořadí severozápad, severovýchod, jihozápad, jihovýchod. */
function tileCorners(heights, x, y) {
	const side = cornerSideOf(heights);
	return [
		heights[cornerIndex(x, y, side)] ?? 0,
		heights[cornerIndex(x + 1, y, side)] ?? 0,
		heights[cornerIndex(x, y + 1, side)] ?? 0,
		heights[cornerIndex(x + 1, y + 1, side)] ?? 0
	];
}
/** Rovná dlaždice má všechny čtyři rohy stejně vysoko. Na těch stojí budovy. */
function isFlatTile(heights, x, y) {
	const [nw, ne, sw, se] = tileCorners(heights, x, y);
	return nw === ne && ne === sw && sw === se;
}
/**
* Zkroucená dlaždice — čtyři rohy neleží v jedné rovině (sedlo).
*
* Rovinu poznáme z toho, že se součty úhlopříček rovnají. Nerovnají-li se,
* dlaždice se nedá nakreslit jako plocha a silnice po ní nepovede (§7).
*/
function isTwistedTile(heights, x, y) {
	const [nw, ne, sw, se] = tileCorners(heights, x, y);
	return nw + se !== ne + sw;
}
/** Nejnižší roh dlaždice. Základna, podle které se ve 3b řadí kreslení. */
function tileBaseHeight(heights, x, y) {
	const [nw, ne, sw, se] = tileCorners(heights, x, y);
	return Math.min(nw, ne, sw, se);
}
/**
* Nejnižší a nejvyšší roh pod obdélníkem `w × h` dlaždic.
*
* Renderer z toho staví podezdívku: budova stojí horní plochou na **nejvyšším**
* rohu a zeď sahá k **nejnižšímu**, takže na svahu nikde nevisí ve vzduchu.
*/
function areaHeightRange(heights, x, y, w, h) {
	const side = cornerSideOf(heights);
	let min = 15;
	let max = 0;
	let sum = 0;
	let count = 0;
	for (let cy = y; cy <= y + h; cy++) for (let cx = x; cx <= x + w; cx++) {
		if (!cornerInBounds(cx, cy, side)) continue;
		const value = heights[cornerIndex(cx, cy, side)] ?? 0;
		if (value < min) min = value;
		if (value > max) max = value;
		sum += value;
		count++;
	}
	if (min > max) return {
		min: 0,
		max: 0,
		pad: 0
	};
	const pad = Math.round(sum / count);
	return {
		min,
		max,
		pad
	};
}
/**
* Spočítá, co se musí změnit, aby roh `x, y` skončil ve výšce `target` a
* invariant zůstal celý.
*
* **Nic nemění** — vrací jen mapu `roh → nová výška`. Terraforming z T32 z ní
* spočítá cenu **než** se hráče zeptá, a stejnou mapu pak použije k zápisu.
* Kdyby se měnilo rovnou, nešlo by cenu ukázat předem (§12 kritérium 14).
*
* Kaskáda jde do šířky: zvednutý roh dotlačí souseda nejvýš na `výška − 1`,
* ten svého souseda, a tak dál, dokud se vlna nezastaví o terén, který
* invariant splňuje sám.
*/
function planCornerHeight(heights, x, y, target) {
	const side = cornerSideOf(heights);
	const changes = /* @__PURE__ */ new Map();
	if (!cornerInBounds(x, y, side)) return changes;
	const clamped = Math.max(0, Math.min(15, Math.round(target)));
	const start = cornerIndex(x, y, side);
	if ((heights[start] ?? 0) === clamped) return changes;
	const heightAt = (corner) => changes.get(corner) ?? heights[corner] ?? 0;
	changes.set(start, clamped);
	const queue = [start];
	while (queue.length > 0) {
		const corner = queue.shift();
		if (corner === void 0) break;
		const here = heightAt(corner);
		const cx = corner % side;
		const cy = (corner - cx) / side;
		for (const [dx, dy] of NEIGHBOURS$4) {
			const nx = cx + dx;
			const ny = cy + dy;
			if (!cornerInBounds(nx, ny, side)) continue;
			const neighbour = cornerIndex(nx, ny, side);
			const value = heightAt(neighbour);
			const wanted = value < here - 1 ? here - 1 : value > here + 1 ? here + 1 : value;
			if (wanted === value) continue;
			changes.set(neighbour, Math.max(0, Math.min(15, wanted)));
			queue.push(neighbour);
		}
	}
	return changes;
}
/**
* Plán srovnání obdélníku dlaždic do jedné výšky (§7 fáze 3).
*
* Skládá se z jednotlivých kaskád, protože ty se **navzájem ovlivňují**:
* srovnání druhého rohu už musí vidět, co udělal ten první. Proto se počítá nad
* pracovní kopií a vrací se sjednocení změn.
*
* Cílová výška je zaokrouhlený průměr rohů oblasti. Je to volba pro hráče
* nejlevnější: srovnání na nejvyšší nebo nejnižší roh by hýbalo víc terénem
* a stálo víc.
*/
function planLevelArea(heights, x, y, width, depth, target) {
	const side = cornerSideOf(heights);
	const corners = [];
	for (let cy = y; cy <= y + depth; cy++) for (let cx = x; cx <= x + width; cx++) if (cornerInBounds(cx, cy, side)) corners.push(cornerIndex(cx, cy, side));
	const changes = /* @__PURE__ */ new Map();
	if (corners.length === 0) return changes;
	let level = target;
	if (level === void 0) {
		let sum = 0;
		for (const corner of corners) sum += heights[corner] ?? 0;
		level = Math.round(sum / corners.length);
	}
	const working = Uint8Array.from(heights);
	for (const corner of corners) {
		const cx = corner % side;
		const step = planCornerHeight(working, cx, (corner - cx) / side, level);
		applyCornerChanges(working, step);
		for (const [at, value] of step) changes.set(at, value);
	}
	for (const [at, value] of [...changes]) if ((heights[at] ?? 0) === value) changes.delete(at);
	return changes;
}
/** Zapíše plán z `planCornerHeight`. Oddělené schválně — viz komentář tamtéž. */
function applyCornerChanges(heights, changes) {
	for (const [corner, value] of changes) heights[corner] = value;
}
/**
* Srovná výškové pole tak, aby invariant platil všude.
*
* Používá to generátor: šum ani koryto řeky se o sousedy nestarají, tak se
* výsledek nakonec „nechá stéct" — každý roh se stlačí nejvýš na `soused + 1`.
* Opakuje se, dokud se něco mění; kroky jsou zastropované, aby nešlo o
* nekonečnou smyčku, kdyby se model někdy změnil.
*
* Vrací počet průchodů, což je jediné, co při ladění generátoru zajímá.
*/
function relaxHeights(heights, maxPasses = 64) {
	const side = cornerSideOf(heights);
	for (let pass = 1; pass <= maxPasses; pass++) {
		let changed = false;
		for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
			const corner = cornerIndex(x, y, side);
			const here = heights[corner] ?? 0;
			let lowest = 15;
			for (const [dx, dy] of NEIGHBOURS$4) {
				const nx = x + dx;
				const ny = y + dy;
				if (!cornerInBounds(nx, ny, side)) continue;
				lowest = Math.min(lowest, heights[cornerIndex(nx, ny, side)] ?? 0);
			}
			if (here > lowest + 1) {
				heights[corner] = lowest + 1;
				changed = true;
			}
		}
		if (!changed) return pass;
	}
	return maxPasses;
}
/**
* Dozdí obdélník dlaždic na jeho **nejvyšší roh**.
*
* Jedno místo pro tři různé potřeby: srovnání sedla pod silnicí (T61),
* nabídku „dozdít" v terénním nástroji a automatické srovnání parcely pod
* budovou (T66). Kdyby si to každá počítala po svém, lišily by se v tom, jestli
* se kope nebo přisypává — a hráč by ze hry měl tři různá pravidla.
*
* Dozdívá se, ne odkopává: hráč staví násep, ne výkop, a odkopání by navíc
* sneslo terén i pod sousedy, kteří o to nežádali.
*/
function planFillArea(heights, x, y, w, h) {
	const { max } = areaHeightRange(heights, x, y, w, h);
	return planLevelArea(heights, x, y, w, h, max);
}
/**
* Jak srovnat dlaždici pod vozovkou, aby silnice nebyla nakloněná do strany.
*
* **Vozovka smí stoupat, ale ne se klopit.** Silnice vedená napříč svahem
* vypadá šejdrem — jede rovně, ale je nakloněná bokem — a přesně na to si
* autor stěžoval.
*
* Rovnou dlaždici z toho udělat **nejde a nikdy nepůjde**: sousední dlaždice
* sdílejí rohy, takže dvě sousední rovné dlaždice musí být ve stejné výšce.
* Kdyby byla rovná každá silniční dlaždice, ležela by celá síť v jedné rovině.
* Jde ale zrušit **příčný spád** — sklon kolmý na směr jízdy:
*
* - silnice sever–jih: srovnají se západní roh s východním, zvlášť nahoře
*   a zvlášť dole, takže vozovka stoupá podél sebe a neklopí se,
* - silnice východ–západ: totéž otočené,
* - zatáčka a křižovatka: rovná celá, protože „směr jízdy" tam žádný není.
*
* Rovná se **nahoru**, ne na průměr, ze stejného důvodu jako u sedla: hráč
* staví násep, ne výkop, a snížený roh by z dlaždice udělal důlek mezi sousedy.
*
* `mask` je bitmaska sousedních silnic (N=1, E=2, S=4, W=8) — táž, kterou
* kreslí renderer, aby se vozovka a terén nerozešly.
*/
function planRoadGrade(heights, x, y, mask) {
	const side = cornerSideOf(heights);
	const at = (cx, cy) => cornerIndex(cx, cy, side);
	const [nw, ne, sw, se] = tileCorners(heights, x, y);
	const northSouth = (mask & 5) !== 0;
	const eastWest = (mask & 10) !== 0;
	/** Dvojice rohů, které musí být stejně vysoko. */
	let pairs;
	if (northSouth && !eastWest) pairs = [[
		at(x, y),
		at(x + 1, y),
		Math.max(nw, ne)
	], [
		at(x, y + 1),
		at(x + 1, y + 1),
		Math.max(sw, se)
	]];
	else if (eastWest && !northSouth) pairs = [[
		at(x, y),
		at(x, y + 1),
		Math.max(nw, sw)
	], [
		at(x + 1, y),
		at(x + 1, y + 1),
		Math.max(ne, se)
	]];
	else if (mask === 0) return planUntwist(heights, x, y);
	else {
		const top = Math.max(nw, ne, sw, se);
		pairs = [[
			at(x, y),
			at(x + 1, y),
			top
		], [
			at(x, y + 1),
			at(x + 1, y + 1),
			top
		]];
	}
	const working = Uint8Array.from(heights);
	const changes = /* @__PURE__ */ new Map();
	for (const [a, b, target] of pairs) for (const corner of [a, b]) {
		const cx = corner % side;
		const step = planCornerHeight(working, cx, (corner - cx) / side, target);
		applyCornerChanges(working, step);
		for (const [k, v] of step) changes.set(k, v);
	}
	for (const [k, v] of [...changes]) if ((heights[k] ?? 0) === v) changes.delete(k);
	return changes;
}
/**
* Jak srovnat zkroucenou dlaždici, aby po ní šla vést vozovka.
*
* Zkroucená dlaždice je sedlo: `nw + se ≠ ne + sw`. Vozovka po ní nejde přejet
* po rovině a nejde ji ani nakreslit, tak ji hráč musel do T61 srovnat ručně —
* a protože se to muselo trefit na správný roh, končilo to většinou tím, že si
* kolem kopce udělal okliku.
*
* **Dozdí se na nejvyšší roh** (rozhodnutí autora). Sedlo se dá zrušit i tím,
* že se pohne jedním jediným rohem, a vyjde to levněji — jenže z takové
* dlaždice se stane osamocený špičák nebo důlek mezi sousedy a svah pak vypadá
* jako schodiště poskládané z jehel. Dozdění nechá terasu, která k okolnímu
* kopci sedí, a **nikdy nekope**: hráč staví násep, ne výkop.
*
* Dozdění **vždycky vyjde**: rovná dlaždice má všechny čtyři rohy stejně, takže
* rovnost platí sama sebou. Proto se nevrací „nedá se to" — plán existuje pro
* každé sedlo a odmítnout ho může až `checkTerraform`, když je v cestě budova
* nebo voda. Na dlaždici, která zkroucená není, vrací **prázdný plán**.
*/
function planUntwist(heights, x, y) {
	if (!isTwistedTile(heights, x, y)) return /* @__PURE__ */ new Map();
	return planFillArea(heights, x, y, 1, 1);
}
//#endregion
//#region src/content/balance.ts
var DISASTER_METRICS = [
	"none",
	"buildings",
	"population",
	"roadTiles",
	"coastTiles",
	"forestTiles",
	"flatShare",
	"industrialBuildings",
	"residentialBuildings",
	"heavyIndustry",
	"powerPlants",
	"riskySlopes"
];
function asRecord$1(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	return value;
}
function section(issues, root, name) {
	const value = asRecord$1(root[name]);
	if (!value) issues.push({
		field: name,
		message: "chybí, nebo není objekt"
	});
	return value;
}
/** Balanc pracuje s desetinnými čísly, takže vlastní kontrola místo `requireInt`. */
function num(issues, container, key, field, min, max) {
	if (!container) return 0;
	const value = container[key];
	if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
		issues.push({
			field,
			message: `musí být číslo v rozsahu ${min}–${max}`
		});
		return 0;
	}
	return value;
}
function validateBalance(raw) {
	const issues = [];
	const root = asRecord$1(raw);
	if (!root) return {
		balance: null,
		issues: [{
			field: "",
			message: "balance musí být objekt"
		}]
	};
	const economy = section(issues, root, "economy");
	const demand = section(issues, root, "demand");
	const map = section(issues, root, "map");
	const traffic = section(issues, root, "traffic");
	const diffusion = section(issues, root, "diffusion");
	const landValue = section(issues, root, "landValue");
	const crime = section(issues, root, "crime");
	const waste = section(issues, root, "waste");
	const sewage = section(issues, root, "sewage");
	const happiness = section(issues, root, "happiness");
	const water = section(issues, root, "water");
	const health = section(issues, root, "health");
	const levels = section(issues, root, "levels");
	const growth = section(issues, root, "growth");
	const weights = {};
	const rawWeights = landValue ? asRecord$1(landValue["weights"]) : null;
	if (!rawWeights) issues.push({
		field: "landValue.weights",
		message: "chybí, nebo není objekt"
	});
	else {
		for (const key of Object.keys(rawWeights).sort()) weights[key] = num(issues, rawWeights, key, `landValue.weights.${key}`, -100, 100);
		for (const required of ["pollution", "crime"]) if (weights[required] === void 0) issues.push({
			field: `landValue.weights.${required}`,
			message: "chybí"
		});
	}
	const happinessWeights = {};
	const rawHappinessWeights = happiness ? asRecord$1(happiness["weights"]) : null;
	if (!rawHappinessWeights) issues.push({
		field: "happiness.weights",
		message: "chybí, nebo není objekt"
	});
	else for (const key of Object.keys(rawHappinessWeights).sort()) happinessWeights[key] = num(issues, rawHappinessWeights, key, `happiness.weights.${key}`, -10, 10);
	const thresholds = [];
	const rawThresholds = levels?.["thresholds"];
	if (!Array.isArray(rawThresholds) || rawThresholds.length === 0) issues.push({
		field: "levels.thresholds",
		message: "musí být neprázdné pole"
	});
	else rawThresholds.forEach((value, i) => {
		if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 255) issues.push({
			field: `levels.thresholds[${i}]`,
			message: "musí být celé číslo 0–255"
		});
		else thresholds.push(value);
	});
	const roadFactors = [];
	const rawRoadFactors = growth?.["roadFactors"];
	if (!Array.isArray(rawRoadFactors) || rawRoadFactors.length < 2) issues.push({
		field: "growth.roadFactors",
		message: "musí být pole aspoň o dvou prvcích (index = vzdálenost k silnici)"
	});
	else rawRoadFactors.forEach((value, i) => {
		if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) issues.push({
			field: `growth.roadFactors[${i}]`,
			message: "musí být číslo v rozsahu 0–1"
		});
		else roadFactors.push(value);
	});
	const disasters = section(issues, root, "disasters");
	const disasterTypes = validateDisasters(issues, disasters);
	const roadTypes = [];
	const rawRoadTypes = traffic?.["roadTypes"];
	if (!Array.isArray(rawRoadTypes) || rawRoadTypes.length === 0) issues.push({
		field: "traffic.roadTypes",
		message: "musí být neprázdné pole typů silnic"
	});
	else rawRoadTypes.forEach((entry, i) => {
		const where = `traffic.roadTypes[${i}]`;
		const record = asRecord$1(entry);
		if (!record) {
			issues.push({
				field: where,
				message: "musí být objekt"
			});
			return;
		}
		const id = record["id"];
		if (typeof id !== "string" || id.length === 0) {
			issues.push({
				field: `${where}.id`,
				message: "musí být neprázdný řetězec"
			});
			return;
		}
		roadTypes.push({
			id,
			capacity: num(issues, record, "capacity", `${where}.capacity`, 1, 1e4),
			cost: num(issues, record, "cost", `${where}.cost`, 0, 1e5),
			upkeep: num(issues, record, "upkeep", `${where}.upkeep`, 0, 1e5)
		});
	});
	const balance = {
		disasters: {
			maxRiskMultiplier: num(issues, disasters, "maxRiskMultiplier", "disasters.maxRiskMultiplier", 1, 100),
			indicators: {
				uncoveredBelow: num(issues, disasters ? asRecord$1(disasters["indicators"]) : null, "uncoveredBelow", "disasters.indicators.uncoveredBelow", 0, 255),
				denseLevel: num(issues, disasters ? asRecord$1(disasters["indicators"]) : null, "denseLevel", "disasters.indicators.denseLevel", 1, 5),
				ageTicks: num(issues, disasters ? asRecord$1(disasters["indicators"]) : null, "ageTicks", "disasters.indicators.ageTicks", 0, 1e6)
			},
			damage: { highLevel: num(issues, disasters ? asRecord$1(disasters["damage"]) : null, "highLevel", "disasters.damage.highLevel", 1, 5) },
			rubble: {
				clearCost: num(issues, disasters ? asRecord$1(disasters["rubble"]) : null, "clearCost", "disasters.rubble.clearCost", 0, 1e5),
				crimeWeight: num(issues, disasters ? asRecord$1(disasters["rubble"]) : null, "crimeWeight", "disasters.rubble.crimeWeight", 0, 100),
				landValuePenalty: num(issues, disasters ? asRecord$1(disasters["rubble"]) : null, "landValuePenalty", "disasters.rubble.landValuePenalty", 0, 255)
			},
			fire: validateFire(issues, disasters),
			flood: validateFlood(issues, disasters),
			tornado: validateTornado(issues, disasters),
			earthquake: validateEarthquake(issues, disasters),
			blast: validateBlast(issues, disasters),
			pileup: validatePileup(issues, disasters),
			strike: validateStrike(issues, disasters),
			riot: validateRiot(issues, disasters),
			gangWar: validateGangWar(issues, disasters),
			blackout: validateBlackout(issues, disasters),
			epidemic: validateEpidemic(issues, disasters),
			chemicalSpill: validateChemicalSpill(issues, disasters),
			landslide: validateLandslide(issues, disasters),
			types: disasterTypes
		},
		economy: {
			taxableValuePerUnit: num(issues, economy, "taxableValuePerUnit", "economy.taxableValuePerUnit", 0, 1e4),
			startingFunds: num(issues, economy, "startingFunds", "economy.startingFunds", 0, 1e8),
			defaultTaxRate: num(issues, economy, "defaultTaxRate", "economy.defaultTaxRate", 0, 100)
		},
		demand: {
			workerRatio: num(issues, demand, "workerRatio", "demand.workerRatio", 0, 1),
			baseResidential: num(issues, demand, "baseResidential", "demand.baseResidential", 0, 1e3),
			commercePerCapita: num(issues, demand, "commercePerCapita", "demand.commercePerCapita", 0, 100),
			limit: num(issues, demand, "limit", "demand.limit", 1, 1e3)
		},
		map: {
			seaLevel: num(issues, map, "seaLevel", "map.seaLevel", 0, 1),
			rockLevel: num(issues, map, "rockLevel", "map.rockLevel", 0, 1),
			beachWidth: num(issues, map, "beachWidth", "map.beachWidth", 0, 32),
			forestDensity: num(issues, map, "forestDensity", "map.forestDensity", 0, 1),
			marshThreshold: num(issues, map, "marshThreshold", "map.marshThreshold", 0, 1),
			octaves: num(issues, map, "octaves", "map.octaves", 1, 8),
			roughness: num(issues, map, "roughness", "map.roughness", 0, 1),
			heightScale: num(issues, map, "heightScale", "map.heightScale", 1, 256),
			forestScale: num(issues, map, "forestScale", "map.forestScale", 1, 256),
			scrapIslandTiles: num(issues, map, "scrapIslandTiles", "map.scrapIslandTiles", 0, 4096),
			forestAbsorption: num(issues, map, "forestAbsorption", "map.forestAbsorption", 0, 1),
			clearForestCost: num(issues, map, "clearForestCost", "map.clearForestCost", 0, 1e5),
			maxLevelledZoneTiles: num(issues, map, "maxLevelledZoneTiles", "map.maxLevelledZoneTiles", 0, 1e5),
			minLandShare: num(issues, map, "minLandShare", "map.minLandShare", 0, 1),
			maxHeight: num(issues, map, "maxHeight", "map.maxHeight", 0, 15),
			heightCurve: num(issues, map, "heightCurve", "map.heightCurve", .1, 8),
			rivers: num(issues, map, "rivers", "map.rivers", 0, 16),
			riverSourceHeight: num(issues, map, "riverSourceHeight", "map.riverSourceHeight", 0, 15),
			terraformCost: num(issues, map, "terraformCost", "map.terraformCost", 0, 1e5),
			clearRockCost: num(issues, map, "clearRockCost", "map.clearRockCost", 0, 1e5),
			fillMarshCost: num(issues, map, "fillMarshCost", "map.fillMarshCost", 0, 1e5)
		},
		traffic: {
			roadTypes,
			attempts: num(issues, traffic, "attempts", "traffic.attempts", 1, 100),
			maxSteps: num(issues, traffic, "maxSteps", "traffic.maxSteps", 1, 1e3),
			maxBuildingsPerRun: num(issues, traffic, "maxBuildingsPerRun", "traffic.maxBuildingsPerRun", 1, 1e5),
			smoothing: num(issues, traffic, "smoothing", "traffic.smoothing", 0, 1),
			transitReduction: num(issues, traffic, "transitReduction", "traffic.transitReduction", 0, 1),
			bridgeCost: num(issues, traffic, "bridgeCost", "traffic.bridgeCost", 0, 1e5)
		},
		diffusion: {
			spread: num(issues, diffusion, "spread", "diffusion.spread", 0, 1),
			decay: num(issues, diffusion, "decay", "diffusion.decay", 0, 1),
			passes: num(issues, diffusion, "passes", "diffusion.passes", 1, 8)
		},
		landValue: {
			base: num(issues, landValue, "base", "landValue.base", 0, 255),
			smoothing: num(issues, landValue, "smoothing", "landValue.smoothing", 0, 1),
			waterBonus: num(issues, landValue, "waterBonus", "landValue.waterBonus", 0, 255),
			weights
		},
		crime: {
			smoothing: num(issues, crime, "smoothing", "crime.smoothing", 0, 1),
			population: num(issues, crime, "population", "crime.population", 0, 10),
			unemployment: num(issues, crime, "unemployment", "crime.unemployment", 0, 255),
			abandoned: num(issues, crime, "abandoned", "crime.abandoned", 0, 255),
			police: num(issues, crime, "police", "crime.police", 0, 10)
		},
		water: {
			defaultRange: num(issues, water, "defaultRange", "water.defaultRange", 1, 1e3),
			pipeCost: num(issues, water, "pipeCost", "water.pipeCost", 0, 1e5),
			decayStep: num(issues, water, "decayStep", "water.decayStep", 0, 1e3),
			abandonAfter: num(issues, water, "abandonAfter", "water.abandonAfter", 1, 1e3)
		},
		happiness: {
			base: num(issues, happiness, "base", "happiness.base", 0, 255),
			smoothing: num(issues, happiness, "smoothing", "happiness.smoothing", 0, 1),
			landValue: num(issues, happiness, "landValue", "happiness.landValue", 0, 100),
			pollution: num(issues, happiness, "pollution", "happiness.pollution", 0, 100),
			crime: num(issues, happiness, "crime", "happiness.crime", 0, 100),
			congestion: num(issues, happiness, "congestion", "happiness.congestion", 0, 1e3),
			tax: num(issues, happiness, "tax", "happiness.tax", 0, 100),
			unemployment: num(issues, happiness, "unemployment", "happiness.unemployment", 0, 1e3),
			minDemandFactor: num(issues, happiness, "minDemandFactor", "happiness.minDemandFactor", 0, 1),
			weights: happinessWeights
		},
		sewage: {
			perCitizen: num(issues, sewage, "perCitizen", "sewage.perCitizen", 0, 100),
			toPollution: num(issues, sewage, "toPollution", "sewage.toPollution", 0, 100)
		},
		waste: {
			perCitizen: num(issues, waste, "perCitizen", "waste.perCitizen", 0, 100),
			toPollution: num(issues, waste, "toPollution", "waste.toPollution", 0, 100)
		},
		health: {
			coverageThreshold: num(issues, health, "coverageThreshold", "health.coverageThreshold", 0, 255),
			declineStep: num(issues, health, "declineStep", "health.declineStep", 0, 255),
			recoveryStep: num(issues, health, "recoveryStep", "health.recoveryStep", 0, 255),
			unservedRatio: num(issues, health, "unservedRatio", "health.unservedRatio", 0, 1)
		},
		levels: {
			thresholds,
			hysteresis: num(issues, levels, "hysteresis", "levels.hysteresis", 0, 255),
			cooldown: num(issues, levels, "cooldown", "levels.cooldown", 0, 1e5),
			downgradeConfirm: num(issues, levels, "downgradeConfirm", "levels.downgradeConfirm", 1, 100),
			decayAge: num(issues, levels, "decayAge", "levels.decayAge", 0, 1e6),
			decayCoverageThreshold: num(issues, levels, "decayCoverageThreshold", "levels.decayCoverageThreshold", 0, 255),
			decayPenalty: num(issues, levels, "decayPenalty", "levels.decayPenalty", 0, 255),
			demandRelief: num(issues, levels, "demandRelief", "levels.demandRelief", 0, 255)
		},
		finance: validateFinance(issues, root),
		transit: validateTransit$1(issues, root),
		growth: {
			exponent: num(issues, growth, "exponent", "growth.exponent", 0, 10),
			demandPerAttempt: num(issues, growth, "demandPerAttempt", "growth.demandPerAttempt", 1, 1e3),
			maxAttempts: num(issues, growth, "maxAttempts", "growth.maxAttempts", 1, 1e3),
			neutralTaxRate: num(issues, growth, "neutralTaxRate", "growth.neutralTaxRate", 0, 100),
			taxRange: num(issues, growth, "taxRange", "growth.taxRange", 1, 100),
			roadFactors,
			minAccessFactor: num(issues, growth, "minAccessFactor", "growth.minAccessFactor", 0, 1),
			slopeFactor: num(issues, growth, "slopeFactor", "growth.slopeFactor", 0, 1)
		}
	};
	return {
		balance: issues.length > 0 ? null : balance,
		issues
	};
}
/**
* Katastrofy z balancu.
*
* Kontroluje se **tvar, ne smysl**: že metrika existuje, že pravděpodobnost je
* v rozsahu 0–1, že strop není pod základem. Jestli je 0,02 měsíčně málo nebo
* moc, se pozná hraním, ne validací.
*
* Neznámá metrika je chyba, ne varování. Překlep v `buildigns` by jinak tiše
* znamenal „škáluj podle nuly", tedy katastrofu, která nikdy nepřijde.
*/
function validateDisasters(issues, disasters) {
	const out = {};
	const rawTypes = disasters ? asRecord$1(disasters["types"]) : null;
	if (!rawTypes) {
		if (disasters) issues.push({
			field: "disasters.types",
			message: "chybí, nebo není objekt"
		});
		return out;
	}
	for (const kind of Object.keys(rawTypes).sort()) {
		const where = `disasters.types.${kind}`;
		const record = asRecord$1(rawTypes[kind]);
		if (!record) {
			issues.push({
				field: where,
				message: "musí být objekt"
			});
			continue;
		}
		const base = num(issues, record, "baseMonthlyChance", `${where}.baseMonthlyChance`, 0, 1);
		const cap = num(issues, record, "maxMonthlyChance", `${where}.maxMonthlyChance`, 0, 1);
		if (cap < base) issues.push({
			field: `${where}.maxMonthlyChance`,
			message: "strop nesmí být pod základem"
		});
		const natural = record["natural"];
		if (typeof natural !== "boolean") issues.push({
			field: `${where}.natural`,
			message: "musí být true nebo false"
		});
		out[kind] = {
			baseMonthlyChance: base,
			maxMonthlyChance: cap,
			cooldownTicks: num(issues, record, "cooldownTicks", `${where}.cooldownTicks`, 0, 1e5),
			natural: natural === true,
			concurrent: validateConcurrent(issues, record, where),
			...record["scale"] === void 0 ? {} : { scale: validateScale(issues, asRecord$1(record["scale"]), `${where}.scale`) },
			...record["season"] === void 0 ? {} : { season: validateSeason(issues, asRecord$1(record["season"]), `${where}.season`) },
			require: validateRequire(issues, record["require"], `${where}.require`),
			risk: validateRisk(issues, record["risk"], `${where}.risk`, natural === true),
			...record["burn"] === void 0 ? {} : { burn: validateBurn(issues, asRecord$1(record["burn"]), `${where}.burn`) }
		};
	}
	return out;
}
function metric(issues, container, key, field) {
	const value = container?.[key];
	if (typeof value !== "string" || !DISASTER_METRICS.includes(value)) {
		issues.push({
			field,
			message: `neznámá veličina; povolené: ${DISASTER_METRICS.join(", ")}`
		});
		return "none";
	}
	return value;
}
function validateConcurrent(issues, record, where) {
	const raw = asRecord$1(record["concurrent"]);
	if (!raw) {
		issues.push({
			field: `${where}.concurrent`,
			message: "chybí, nebo není objekt"
		});
		return {
			metric: "none",
			divisor: 1,
			min: 1,
			max: 1
		};
	}
	const min = num(issues, raw, "min", `${where}.concurrent.min`, 1, 100);
	const max = num(issues, raw, "max", `${where}.concurrent.max`, 1, 100);
	if (max < min) issues.push({
		field: `${where}.concurrent.max`,
		message: "nesmí být pod min"
	});
	return {
		metric: metric(issues, raw, "metric", `${where}.concurrent.metric`),
		divisor: num(issues, raw, "divisor", `${where}.concurrent.divisor`, 1, 1e6),
		min,
		max
	};
}
function validateScale(issues, raw, where) {
	if (!raw) {
		issues.push({
			field: where,
			message: "musí být objekt"
		});
		return {
			metric: "none",
			curve: "linear",
			divisor: 1,
			offset: 0,
			min: 1,
			max: 1
		};
	}
	const curve = raw["curve"];
	if (curve !== "sqrt" && curve !== "linear") issues.push({
		field: `${where}.curve`,
		message: "musí být 'sqrt' nebo 'linear'"
	});
	return {
		metric: metric(issues, raw, "metric", `${where}.metric`),
		curve: curve === "sqrt" ? "sqrt" : "linear",
		divisor: num(issues, raw, "divisor", `${where}.divisor`, 1e-6, 1e6),
		offset: num(issues, raw, "offset", `${where}.offset`, -10, 10),
		min: num(issues, raw, "min", `${where}.min`, 0, 100),
		max: num(issues, raw, "max", `${where}.max`, 0, 100)
	};
}
function validateSeason(issues, raw, where) {
	if (!raw) {
		issues.push({
			field: where,
			message: "musí být objekt"
		});
		return {
			from: 0,
			to: 0,
			inFactor: 1,
			outFactor: 1
		};
	}
	return {
		from: num(issues, raw, "from", `${where}.from`, 0, 359),
		to: num(issues, raw, "to", `${where}.to`, 0, 360),
		inFactor: num(issues, raw, "inFactor", `${where}.inFactor`, 0, 20),
		outFactor: num(issues, raw, "outFactor", `${where}.outFactor`, 0, 20)
	};
}
function validateRequire(issues, raw, where) {
	if (!Array.isArray(raw)) {
		issues.push({
			field: where,
			message: "musí být pole (klidně prázdné)"
		});
		return [];
	}
	return raw.map((entry, i) => {
		const record = asRecord$1(entry);
		if (!record) {
			issues.push({
				field: `${where}[${i}]`,
				message: "musí být objekt"
			});
			return {
				metric: "none",
				min: 0
			};
		}
		return {
			metric: metric(issues, record, "metric", `${where}[${i}].metric`),
			min: num(issues, record, "min", `${where}[${i}].min`, 0, 1e6)
		};
	});
}
function validateRisk(issues, raw, where, natural) {
	if (!Array.isArray(raw)) {
		issues.push({
			field: where,
			message: "musí být pole (klidně prázdné)"
		});
		return [];
	}
	if (natural && raw.length > 0) issues.push({
		field: where,
		message: "přírodní katastrofa nemá faktor typu, seznam musí být prázdný"
	});
	return raw.map((entry, i) => {
		const record = asRecord$1(entry);
		if (!record) {
			issues.push({
				field: `${where}[${i}]`,
				message: "musí být objekt"
			});
			return {
				indicator: "",
				weight: 0
			};
		}
		const indicator = record["indicator"];
		if (typeof indicator !== "string" || indicator.length === 0) issues.push({
			field: `${where}[${i}].indicator`,
			message: "musí být neprázdný řetězec"
		});
		return {
			indicator: typeof indicator === "string" ? indicator : "",
			weight: num(issues, record, "weight", `${where}[${i}].weight`, -100, 100),
			...record["below"] === void 0 ? {} : { below: num(issues, record, "below", `${where}[${i}].below`, 0, 1) }
		};
	});
}
function validateBurn(issues, raw, where) {
	if (!raw) {
		issues.push({
			field: where,
			message: "musí být objekt"
		});
		return {
			wildfire: false,
			ignitionIntensity: 100,
			intensityGrowth: 1,
			spreadChance: 0,
			minIgnitions: 1,
			maxIgnitions: 1
		};
	}
	const min = num(issues, raw, "minIgnitions", `${where}.minIgnitions`, 1, 100);
	const max = num(issues, raw, "maxIgnitions", `${where}.maxIgnitions`, 1, 100);
	if (max < min) issues.push({
		field: `${where}.maxIgnitions`,
		message: "nesmí být pod min"
	});
	return {
		wildfire: raw["wildfire"] === true,
		ignitionIntensity: num(issues, raw, "ignitionIntensity", `${where}.ignitionIntensity`, 1, 255),
		intensityGrowth: num(issues, raw, "intensityGrowth", `${where}.intensityGrowth`, 0, 255),
		spreadChance: num(issues, raw, "spreadChance", `${where}.spreadChance`, 0, 1),
		minIgnitions: min,
		maxIgnitions: max
	};
}
/**
* Model ohně.
*
* Hořlavost je pravděpodobnost, tedy 0–1. Palivo je počet ohňových tiků do
* zničení — celé číslo, protože se odečítá po jedné. Kdyby některé chybělo,
* příslušný obsah dlaždice by tiše nehořel vůbec; proto se kontroluje, že
* jsou obě tabulky úplné.
*/
function validateFire(issues, disasters) {
	const raw = disasters ? asRecord$1(disasters["fire"]) : null;
	const empty = {
		tickInterval: 2,
		suppressBase: 0,
		suppressPerCoverage: 0,
		pollutionPerTick: 0,
		happinessPerLoss: 0,
		happinessPenaltyTicks: 0,
		flammability: {},
		fuel: {},
		byClass: {}
	};
	if (!raw) {
		if (disasters) issues.push({
			field: "disasters.fire",
			message: "chybí, nebo není objekt"
		});
		return empty;
	}
	const flammability = {};
	const fuel = {};
	const rawFlammability = asRecord$1(raw["flammability"]);
	const rawFuel = asRecord$1(raw["fuel"]);
	if (!rawFlammability) issues.push({
		field: "disasters.fire.flammability",
		message: "chybí, nebo není objekt"
	});
	else for (const key of Object.keys(rawFlammability).sort()) flammability[key] = num(issues, rawFlammability, key, `disasters.fire.flammability.${key}`, 0, 1);
	if (!rawFuel) issues.push({
		field: "disasters.fire.fuel",
		message: "chybí, nebo není objekt"
	});
	else for (const key of Object.keys(rawFuel).sort()) fuel[key] = num(issues, rawFuel, key, `disasters.fire.fuel.${key}`, 1, 1e3);
	for (const key of Object.keys(flammability)) if (fuel[key] === void 0) issues.push({
		field: `disasters.fire.fuel.${key}`,
		message: "chybí ke stejné hořlavosti"
	});
	const byClass = {};
	const rawByClass = asRecord$1(raw["byClass"]) ?? {};
	for (const key of Object.keys(rawByClass).sort()) {
		const entry = asRecord$1(rawByClass[key]);
		if (!entry) {
			issues.push({
				field: `disasters.fire.byClass.${key}`,
				message: "musí být objekt"
			});
			continue;
		}
		byClass[key] = {
			flammability: num(issues, entry, "flammability", `disasters.fire.byClass.${key}.flammability`, 0, 1),
			fuel: num(issues, entry, "fuel", `disasters.fire.byClass.${key}.fuel`, 1, 1e3)
		};
	}
	return {
		tickInterval: num(issues, raw, "tickInterval", "disasters.fire.tickInterval", 1, 100),
		suppressBase: num(issues, raw, "suppressBase", "disasters.fire.suppressBase", 0, 255),
		suppressPerCoverage: num(issues, raw, "suppressPerCoverage", "disasters.fire.suppressPerCoverage", 0, 10),
		pollutionPerTick: num(issues, raw, "pollutionPerTick", "disasters.fire.pollutionPerTick", 0, 255),
		happinessPerLoss: num(issues, raw, "happinessPerLoss", "disasters.fire.happinessPerLoss", 0, 255),
		happinessPenaltyTicks: num(issues, raw, "happinessPenaltyTicks", "disasters.fire.happinessPenaltyTicks", 0, 1e5),
		flammability,
		fuel,
		byClass
	};
}
/**
* Povodeň z balancu.
*
* Kontroluje se **tvar a pořadí mezí**: `min` nad `max` by znamenalo prázdný
* rozsah a `rng.int()` na záporné šířce vrátí nulu — vlna by se nikdy
* nepohnula a nic by to nehlásilo.
*/
function validateFlood(issues, disasters) {
	const raw = disasters ? asRecord$1(disasters["flood"]) : null;
	if (!raw) {
		if (disasters) issues.push({
			field: "disasters.flood",
			message: "chybí, nebo není objekt"
		});
		return {
			waterRise: 1,
			bayWeight: 0,
			reachMin: 1,
			reachMax: 1,
			advanceTicksMin: 1,
			advanceTicksMax: 1,
			durationMin: 1,
			durationMax: 1,
			drainPerCoverage: 0,
			damagePerDepth: 0,
			pollutionPerTick: 0,
			landValuePenalty: 0,
			happinessPerLoss: 0
		};
	}
	const range = (minKey, maxKey, lo, hi) => {
		const min = num(issues, raw, minKey, `disasters.flood.${minKey}`, lo, hi);
		const max = num(issues, raw, maxKey, `disasters.flood.${maxKey}`, lo, hi);
		if (max < min) issues.push({
			field: `disasters.flood.${maxKey}`,
			message: "nesmí být pod min"
		});
		return [min, max];
	};
	const [reachMin, reachMax] = range("reachMin", "reachMax", 1, 100);
	const [advanceMin, advanceMax] = range("advanceTicksMin", "advanceTicksMax", 1, 1e3);
	const [durationMin, durationMax] = range("durationMin", "durationMax", 1, 1e3);
	return {
		waterRise: num(issues, raw, "waterRise", "disasters.flood.waterRise", 1, 15),
		bayWeight: num(issues, raw, "bayWeight", "disasters.flood.bayWeight", 0, 100),
		reachMin,
		reachMax,
		advanceTicksMin: advanceMin,
		advanceTicksMax: advanceMax,
		durationMin,
		durationMax,
		drainPerCoverage: num(issues, raw, "drainPerCoverage", "disasters.flood.drainPerCoverage", 0, 10),
		damagePerDepth: num(issues, raw, "damagePerDepth", "disasters.flood.damagePerDepth", 0, 255),
		pollutionPerTick: num(issues, raw, "pollutionPerTick", "disasters.flood.pollutionPerTick", 0, 255),
		landValuePenalty: num(issues, raw, "landValuePenalty", "disasters.flood.landValuePenalty", 0, 255),
		happinessPerLoss: num(issues, raw, "happinessPerLoss", "disasters.flood.happinessPerLoss", 0, 255)
	};
}
/** Klíče, které musí každá tabulka obsahu nést. Chybějící se tiše chová jako nula. */
var CONTENT_KINDS = [
	"forest",
	"abandoned",
	"residentialLow",
	"residentialHigh",
	"commercial",
	"industrial",
	"service",
	"utility",
	"road",
	"pipe",
	"rubble",
	"empty"
];
/**
* Tabulka podle obsahu dlaždice.
*
* Kontroluje se **úplnost**: chybějící klíč se v kódu chová jako nula, což
* u odolnosti znamená „zničí se vždycky" a u zranitelnosti „nikdy". Obojí je
* tichá chyba, kterou by hráč objevil až tím, že mu tornádo nechává stát
* zrovna továrny.
*/
function contentTable(issues, container, key, where, max) {
	const raw = container ? asRecord$1(container[key]) : null;
	if (!raw) {
		if (container) issues.push({
			field: where,
			message: "chybí, nebo není objekt"
		});
		return {};
	}
	const table = {};
	for (const name of Object.keys(raw).sort()) table[name] = num(issues, raw, name, `${where}.${name}`, 0, max);
	for (const required of CONTENT_KINDS) if (table[required] === void 0) issues.push({
		field: `${where}.${required}`,
		message: "chybí"
	});
	return table;
}
function validateTornado(issues, disasters) {
	const raw = disasters ? asRecord$1(disasters["tornado"]) : null;
	if (!raw && disasters) issues.push({
		field: "disasters.tornado",
		message: "chybí, nebo není objekt"
	});
	const where = "disasters.tornado";
	const lifetimeMin = num(issues, raw, "lifetimeMin", `${where}.lifetimeMin`, 1, 1e3);
	const lifetimeMax = num(issues, raw, "lifetimeMax", `${where}.lifetimeMax`, 1, 1e3);
	if (lifetimeMax < lifetimeMin) issues.push({
		field: `${where}.lifetimeMax`,
		message: "nesmí být pod min"
	});
	const widthMin = num(issues, raw, "widthMin", `${where}.widthMin`, 1, 100);
	const widthMax = num(issues, raw, "widthMax", `${where}.widthMax`, 1, 100);
	if (widthMax < widthMin) issues.push({
		field: `${where}.widthMax`,
		message: "nesmí být pod min"
	});
	return {
		speed: num(issues, raw, "speed", `${where}.speed`, .1, 100),
		lifetimeMin,
		lifetimeMax,
		widthMin,
		widthMax,
		turnDegrees: num(issues, raw, "turnDegrees", `${where}.turnDegrees`, 0, 180),
		igniteChance: num(issues, raw, "igniteChance", `${where}.igniteChance`, 0, 1),
		igniteIntensity: num(issues, raw, "igniteIntensity", `${where}.igniteIntensity`, 1, 255),
		happinessPerLoss: num(issues, raw, "happinessPerLoss", `${where}.happinessPerLoss`, 0, 255),
		survival: contentTable(issues, raw, "survival", `${where}.survival`, 1)
	};
}
function validateEarthquake(issues, disasters) {
	const raw = disasters ? asRecord$1(disasters["earthquake"]) : null;
	if (!raw && disasters) issues.push({
		field: "disasters.earthquake",
		message: "chybí, nebo není objekt"
	});
	const where = "disasters.earthquake";
	return {
		magnitudeBase: num(issues, raw, "magnitudeBase", `${where}.magnitudeBase`, 0, 1),
		magnitudeSpan: num(issues, raw, "magnitudeSpan", `${where}.magnitudeSpan`, 0, 1),
		falloffShare: num(issues, raw, "falloffShare", `${where}.falloffShare`, .01, 10),
		falloffMin: num(issues, raw, "falloffMin", `${where}.falloffMin`, 0, 1),
		downgradeShare: num(issues, raw, "downgradeShare", `${where}.downgradeShare`, 0, 10),
		aftershocksMin: num(issues, raw, "aftershocksMin", `${where}.aftershocksMin`, 0, 100),
		aftershocksMax: num(issues, raw, "aftershocksMax", `${where}.aftershocksMax`, 0, 100),
		aftershockDelayMin: num(issues, raw, "aftershockDelayMin", `${where}.aftershockDelayMin`, 1, 1e3),
		aftershockDelayMax: num(issues, raw, "aftershockDelayMax", `${where}.aftershockDelayMax`, 1, 1e3),
		aftershockDecay: num(issues, raw, "aftershockDecay", `${where}.aftershockDecay`, 0, 1),
		fireChance: num(issues, raw, "fireChance", `${where}.fireChance`, 0, 1),
		floodChance: num(issues, raw, "floodChance", `${where}.floodChance`, 0, 1),
		floodBand: num(issues, raw, "floodBand", `${where}.floodBand`, 0, 100),
		floodDepth: num(issues, raw, "floodDepth", `${where}.floodDepth`, 0, 255),
		floodDuration: num(issues, raw, "floodDuration", `${where}.floodDuration`, 0, 255),
		igniteIntensity: num(issues, raw, "igniteIntensity", `${where}.igniteIntensity`, 1, 255),
		happinessPerLoss: num(issues, raw, "happinessPerLoss", `${where}.happinessPerLoss`, 0, 255),
		happinessPerDowngrade: num(issues, raw, "happinessPerDowngrade", `${where}.happinessPerDowngrade`, 0, 255),
		vulnerability: contentTable(issues, raw, "vulnerability", `${where}.vulnerability`, 10)
	};
}
function blastKind(issues, container, key, where) {
	const raw = container ? asRecord$1(container[key]) : null;
	if (!raw && container) issues.push({
		field: where,
		message: "chybí, nebo není objekt"
	});
	return {
		radiusBase: num(issues, raw, "radiusBase", `${where}.radiusBase`, 0, 100),
		radiusPerLevel: num(issues, raw, "radiusPerLevel", `${where}.radiusPerLevel`, 0, 100),
		destroyChance: num(issues, raw, "destroyChance", `${where}.destroyChance`, 0, 1),
		igniteReach: num(issues, raw, "igniteReach", `${where}.igniteReach`, 0, 10),
		igniteChance: num(issues, raw, "igniteChance", `${where}.igniteChance`, 0, 1),
		igniteIntensity: num(issues, raw, "igniteIntensity", `${where}.igniteIntensity`, 1, 255),
		pollution: num(issues, raw, "pollution", `${where}.pollution`, 0, 255),
		happinessPerLoss: num(issues, raw, "happinessPerLoss", `${where}.happinessPerLoss`, 0, 255)
	};
}
/**
* Sociální katastrofy (T52).
*
* Všechny čtyři sdílejí jednu myšlenku: hráč je umí zkrátit tím, že zareaguje.
* Proto mají `drain*` místo pevného trvání — a proto se tady kontroluje, že
* `drainRising` je opravdu vyšší než `drainIdle`. Kdyby nebyl, reakce by
* katastrofu prodlužovala a celá mechanika by mlčky přestala dávat smysl.
*/
function validatePileup(issues, disasters) {
	const raw = disasterSection(issues, disasters, "pileup");
	return {
		durationBase: num(issues, raw, "durationBase", "disasters.pileup.durationBase", 1, 200),
		durationSpan: num(issues, raw, "durationSpan", "disasters.pileup.durationSpan", 0, 200),
		reach: num(issues, raw, "reach", "disasters.pileup.reach", 0, 64),
		jamRadius: num(issues, raw, "jamRadius", "disasters.pileup.jamRadius", 0, 64),
		jamFactor: num(issues, raw, "jamFactor", "disasters.pileup.jamFactor", 1, 100),
		healthFactor: num(issues, raw, "healthFactor", "disasters.pileup.healthFactor", 0, 1),
		fireFactor: num(issues, raw, "fireFactor", "disasters.pileup.fireFactor", 0, 1),
		happiness: num(issues, raw, "happiness", "disasters.pileup.happiness", 0, 255),
		populationLoss: num(issues, raw, "populationLoss", "disasters.pileup.populationLoss", 0, 1),
		reportLoad: num(issues, raw, "reportLoad", "disasters.pileup.reportLoad", 0, 1e3)
	};
}
function validateStrike(issues, disasters) {
	const raw = disasterSection(issues, disasters, "strike");
	const value = {
		durationMin: num(issues, raw, "durationMin", "disasters.strike.durationMin", 1, 1e3),
		durationMax: num(issues, raw, "durationMax", "disasters.strike.durationMax", 1, 1e3),
		radiusMin: num(issues, raw, "radiusMin", "disasters.strike.radiusMin", 0, 64),
		radiusMax: num(issues, raw, "radiusMax", "disasters.strike.radiusMax", 0, 64),
		drainIdle: num(issues, raw, "drainIdle", "disasters.strike.drainIdle", .01, 100),
		drainRising: num(issues, raw, "drainRising", "disasters.strike.drainRising", .01, 100),
		crime: num(issues, raw, "crime", "disasters.strike.crime", 0, 255),
		traffic: num(issues, raw, "traffic", "disasters.strike.traffic", 1, 100),
		healthFactor: num(issues, raw, "healthFactor", "disasters.strike.healthFactor", 0, 1),
		happiness: num(issues, raw, "happiness", "disasters.strike.happiness", 0, 255),
		happinessCity: num(issues, raw, "happinessCity", "disasters.strike.happinessCity", 0, 255)
	};
	reactionPays(issues, "disasters.strike", value.drainIdle, value.drainRising);
	return value;
}
function validateRiot(issues, disasters) {
	const raw = disasterSection(issues, disasters, "riot");
	const value = {
		durationMin: num(issues, raw, "durationMin", "disasters.riot.durationMin", 1, 1e3),
		durationMax: num(issues, raw, "durationMax", "disasters.riot.durationMax", 1, 1e3),
		drainIdle: num(issues, raw, "drainIdle", "disasters.riot.drainIdle", .01, 100),
		drainRising: num(issues, raw, "drainRising", "disasters.riot.drainRising", .01, 100),
		drainBoth: num(issues, raw, "drainBoth", "disasters.riot.drainBoth", .01, 100),
		policeCalm: num(issues, raw, "policeCalm", "disasters.riot.policeCalm", 0, 255),
		strengthBase: num(issues, raw, "strengthBase", "disasters.riot.strengthBase", 0, 1),
		crime: num(issues, raw, "crime", "disasters.riot.crime", 0, 255),
		traffic: num(issues, raw, "traffic", "disasters.riot.traffic", 0, 100),
		healthFactor: num(issues, raw, "healthFactor", "disasters.riot.healthFactor", 0, 1),
		educationFactor: num(issues, raw, "educationFactor", "disasters.riot.educationFactor", 0, 1),
		happiness: num(issues, raw, "happiness", "disasters.riot.happiness", 0, 255),
		taxLoss: num(issues, raw, "taxLoss", "disasters.riot.taxLoss", 0, 1),
		igniteEvery: num(issues, raw, "igniteEvery", "disasters.riot.igniteEvery", 1, 100),
		igniteMax: num(issues, raw, "igniteMax", "disasters.riot.igniteMax", 0, 50),
		igniteIntensity: num(issues, raw, "igniteIntensity", "disasters.riot.igniteIntensity", 1, 255),
		escalationCrime: num(issues, raw, "escalationCrime", "disasters.riot.escalationCrime", 0, 255),
		escalationChance: num(issues, raw, "escalationChance", "disasters.riot.escalationChance", 0, 1)
	};
	reactionPays(issues, "disasters.riot", value.drainIdle, value.drainRising);
	reactionPays(issues, "disasters.riot", value.drainRising, value.drainBoth);
	return value;
}
function validateGangWar(issues, disasters) {
	const raw = disasterSection(issues, disasters, "gangWar");
	return {
		durationMin: num(issues, raw, "durationMin", "disasters.gangWar.durationMin", 1, 2e3),
		durationMax: num(issues, raw, "durationMax", "disasters.gangWar.durationMax", 1, 2e3),
		radiusMin: num(issues, raw, "radiusMin", "disasters.gangWar.radiusMin", 0, 64),
		radiusMax: num(issues, raw, "radiusMax", "disasters.gangWar.radiusMax", 0, 64),
		radiusMax2: num(issues, raw, "radiusMax2", "disasters.gangWar.radiusMax2", 0, 64),
		spreadEvery: num(issues, raw, "spreadEvery", "disasters.gangWar.spreadEvery", 1, 500),
		spreadStop: num(issues, raw, "spreadStop", "disasters.gangWar.spreadStop", 0, 255),
		drainBase: num(issues, raw, "drainBase", "disasters.gangWar.drainBase", .01, 100),
		pressurePolice: num(issues, raw, "pressurePolice", "disasters.gangWar.pressurePolice", 0, 10),
		pressureHappiness: num(issues, raw, "pressureHappiness", "disasters.gangWar.pressureHappiness", 0, 10),
		pressureEmployment: num(issues, raw, "pressureEmployment", "disasters.gangWar.pressureEmployment", 0, 10),
		pressureScale: num(issues, raw, "pressureScale", "disasters.gangWar.pressureScale", 0, 100),
		crimeFloor: num(issues, raw, "crimeFloor", "disasters.gangWar.crimeFloor", 0, 255),
		happiness: num(issues, raw, "happiness", "disasters.gangWar.happiness", 0, 255),
		happinessCity: num(issues, raw, "happinessCity", "disasters.gangWar.happinessCity", 0, 255),
		educationFactor: num(issues, raw, "educationFactor", "disasters.gangWar.educationFactor", 0, 1),
		healthFactor: num(issues, raw, "healthFactor", "disasters.gangWar.healthFactor", 0, 1),
		landValue: num(issues, raw, "landValue", "disasters.gangWar.landValue", 0, 255),
		taxLoss: num(issues, raw, "taxLoss", "disasters.gangWar.taxLoss", 0, 1),
		destroyEvery: num(issues, raw, "destroyEvery", "disasters.gangWar.destroyEvery", 1, 500),
		destroyChance: num(issues, raw, "destroyChance", "disasters.gangWar.destroyChance", 0, 1),
		happinessPerLoss: num(issues, raw, "happinessPerLoss", "disasters.gangWar.happinessPerLoss", 0, 255)
	};
}
/** Sekce v `disasters`. Chybějící se hlásí jednou, ne u každého klíče zvlášť. */
function disasterSection(issues, disasters, key) {
	const raw = disasters ? asRecord$1(disasters[key]) : null;
	if (!raw && disasters) issues.push({
		field: `disasters.${key}`,
		message: "chybí, nebo není objekt"
	});
	return raw;
}
/**
* Reakce se musí vyplatit. `faster` je úbytek při zásahu, `slower` bez něj.
*
* Kdyby to bylo obráceně, hráč by katastrofu prodlužoval tím, že se snaží —
* a nikdo by na to nepřišel, protože obojí je jen číslo v datech.
*/
function reactionPays(issues, field, slower, faster) {
	if (faster > slower) return;
	issues.push({
		field,
		message: `reakce musí katastrofu zkracovat: ${faster} není víc než ${slower}`
	});
}
/** Pravdivostní hodnota z balancu. Chybějící se hlásí, nedosazuje. */
function flag(issues, container, key, field) {
	if (!container) return false;
	const value = container[key];
	if (typeof value !== "boolean") {
		issues.push({
			field,
			message: "musí být true nebo false"
		});
		return false;
	}
	return value;
}
/**
* Módy MHD.
*
* Nekontroluje se, že existují zrovna `bus`, `tram` a `metro` — módy jsou
* obsah. Kontroluje se **tvar**: bez toho by mód s chybějící kapacitou tiše
* odvezl nula lidí a hráč by hledal chybu v počtu vozidel.
*/
/**
* Půjčky a rating.
*
* Hlídá se jedna věc navíc: **uzdravování ratingu musí být pomalejší než
* pád**. Kdyby bylo rychlejší, stačilo by pár měsíců v černých číslech
* a nesplácení by nic nestálo — a rating je jediný trest, který za něj hra má.
*/
function validateBonds(issues, finance) {
	const raw = finance ? asRecord$1(finance["bonds"]) : null;
	if (finance && !raw) issues.push({
		field: "finance.bonds",
		message: "chybí, nebo není objekt"
	});
	const where = "finance.bonds";
	return {
		incomeMultiple: num(issues, raw, "incomeMultiple", `${where}.incomeMultiple`, 0, 1e3),
		feeRate: num(issues, raw, "feeRate", `${where}.feeRate`, 0, 1),
		referenceRate: num(issues, raw, "referenceRate", `${where}.referenceRate`, 0, 100),
		maxRate: num(issues, raw, "maxRate", `${where}.maxRate`, 0, 100),
		minMaturityTicks: num(issues, raw, "minMaturityTicks", `${where}.minMaturityTicks`, 1, 1e5),
		maxMaturityTicks: num(issues, raw, "maxMaturityTicks", `${where}.maxMaturityTicks`, 1, 1e5),
		base: num(issues, raw, "base", `${where}.base`, 0, 1),
		rateWeight: num(issues, raw, "rateWeight", `${where}.rateWeight`, 0, 10),
		happinessWeight: num(issues, raw, "happinessWeight", `${where}.happinessWeight`, 0, 10),
		growthWeight: num(issues, raw, "growthWeight", `${where}.growthWeight`, 0, 10),
		crimeWeight: num(issues, raw, "crimeWeight", `${where}.crimeWeight`, 0, 10),
		debtWeight: num(issues, raw, "debtWeight", `${where}.debtWeight`, 0, 10),
		defaultPenalty: num(issues, raw, "defaultPenalty", `${where}.defaultPenalty`, 0, 1),
		blockTicks: num(issues, raw, "blockTicks", `${where}.blockTicks`, 0, 1e5)
	};
}
function validateFinance(issues, root) {
	const raw = section(issues, root, "finance");
	const value = {
		loanIncomeMultiple: num(issues, raw, "loanIncomeMultiple", "finance.loanIncomeMultiple", 0, 1e3),
		maxLoans: num(issues, raw, "maxLoans", "finance.maxLoans", 1, 100),
		minTermMonths: num(issues, raw, "minTermMonths", "finance.minTermMonths", 1, 1e3),
		maxTermMonths: num(issues, raw, "maxTermMonths", "finance.maxTermMonths", 1, 1e3),
		baseRate: num(issues, raw, "baseRate", "finance.baseRate", 0, 100),
		ratePenalty: num(issues, raw, "ratePenalty", "finance.ratePenalty", 0, 100),
		missedPenalty: num(issues, raw, "missedPenalty", "finance.missedPenalty", 0, 1),
		ratingRecovery: num(issues, raw, "ratingRecovery", "finance.ratingRecovery", 0, 1),
		bonds: validateBonds(issues, raw)
	};
	if (raw && value.maxTermMonths < value.minTermMonths) issues.push({
		field: "finance",
		message: `nejdelší doba nesmí být kratší než nejkratší: ${value.maxTermMonths} < ${value.minTermMonths}`
	});
	if (raw && value.bonds.maxMaturityTicks < value.bonds.minMaturityTicks) issues.push({
		field: "finance.bonds",
		message: `nejdelší splatnost nesmí být kratší než nejkratší: ${value.bonds.maxMaturityTicks} < ${value.bonds.minMaturityTicks}`
	});
	if (raw && value.bonds.defaultPenalty <= value.missedPenalty) issues.push({
		field: "finance.bonds",
		message: `nesplacená jistina musí bolet víc než zmeškaná splátka: ${value.bonds.defaultPenalty} není víc než ${value.missedPenalty}`
	});
	if (raw && value.ratingRecovery >= value.missedPenalty) issues.push({
		field: "finance",
		message: `rating se musí léčit pomaleji, než padá: ${value.ratingRecovery} není míň než ${value.missedPenalty}`
	});
	return value;
}
function validateTransit$1(issues, root) {
	const raw = section(issues, root, "transit");
	const modes = {};
	const rawModes = raw ? asRecord$1(raw["modes"]) : null;
	if (raw && !rawModes) issues.push({
		field: "transit.modes",
		message: "chybí, nebo není objekt"
	});
	for (const [name, value] of Object.entries(rawModes ?? {})) {
		const where = `transit.modes.${name}`;
		const mode = asRecord$1(value);
		if (!mode) {
			issues.push({
				field: where,
				message: "musí být objekt"
			});
			continue;
		}
		modes[name] = {
			capacity: num(issues, mode, "capacity", `${where}.capacity`, 1, 1e5),
			vehicleCost: num(issues, mode, "vehicleCost", `${where}.vehicleCost`, 0, 1e6),
			vehicleUpkeep: num(issues, mode, "vehicleUpkeep", `${where}.vehicleUpkeep`, 0, 1e5),
			roadShare: num(issues, mode, "roadShare", `${where}.roadShare`, 0, .9),
			needsPower: flag(issues, mode, "needsPower", `${where}.needsPower`)
		};
	}
	if (raw && Object.keys(modes).length === 0) issues.push({
		field: "transit.modes",
		message: "aspoň jeden mód"
	});
	const minStops = num(issues, raw, "minStops", "transit.minStops", 2, 100);
	const maxStops = num(issues, raw, "maxStops", "transit.maxStops", 2, 100);
	if (raw && maxStops < minStops) issues.push({
		field: "transit",
		message: `strop zastávek nesmí být pod dnem: ${maxStops} < ${minStops}`
	});
	return {
		minStops,
		maxStops,
		fareLimit: num(issues, raw, "fareLimit", "transit.fareLimit", 1, 1e5),
		modes
	};
}
function validateBlackout(issues, disasters) {
	const raw = disasterSection(issues, disasters, "blackout");
	const value = {
		cascadeEvery: num(issues, raw, "cascadeEvery", "disasters.blackout.cascadeEvery", 1, 100),
		overloadRatio: num(issues, raw, "overloadRatio", "disasters.blackout.overloadRatio", 1, 10),
		recoveryRatio: num(issues, raw, "recoveryRatio", "disasters.blackout.recoveryRatio", 0, 10),
		calmCycles: num(issues, raw, "calmCycles", "disasters.blackout.calmCycles", 1, 100),
		noticeTicks: num(issues, raw, "noticeTicks", "disasters.blackout.noticeTicks", 0, 500),
		happinessPerTick: num(issues, raw, "happinessPerTick", "disasters.blackout.happinessPerTick", 0, 255),
		happinessMax: num(issues, raw, "happinessMax", "disasters.blackout.happinessMax", 0, 255),
		penaltyTicks: num(issues, raw, "penaltyTicks", "disasters.blackout.penaltyTicks", 1, 2e3)
	};
	if (raw && value.recoveryRatio >= value.overloadRatio) issues.push({
		field: "disasters.blackout",
		message: `práh zotavení musí být pod prahem přetížení: ${value.recoveryRatio} není míň než ${value.overloadRatio}`
	});
	return value;
}
function validateEpidemic(issues, disasters) {
	const raw = disasterSection(issues, disasters, "epidemic");
	const value = {
		durationMin: num(issues, raw, "durationMin", "disasters.epidemic.durationMin", 1, 2e3),
		durationMax: num(issues, raw, "durationMax", "disasters.epidemic.durationMax", 1, 2e3),
		cycleTicks: num(issues, raw, "cycleTicks", "disasters.epidemic.cycleTicks", 1, 100),
		seed: num(issues, raw, "seed", "disasters.epidemic.seed", 0, 1),
		waves: num(issues, raw, "waves", "disasters.epidemic.waves", 1, 10),
		waveBase: num(issues, raw, "waveBase", "disasters.epidemic.waveBase", 0, 1),
		spread: num(issues, raw, "spread", "disasters.epidemic.spread", 0, 1),
		coverageBlock: num(issues, raw, "coverageBlock", "disasters.epidemic.coverageBlock", 0, 1),
		jumpChance: num(issues, raw, "jumpChance", "disasters.epidemic.jumpChance", 0, 1),
		jumpShare: num(issues, raw, "jumpShare", "disasters.epidemic.jumpShare", 0, 1),
		growth: num(issues, raw, "growth", "disasters.epidemic.growth", 0, 1),
		decay: num(issues, raw, "decay", "disasters.epidemic.decay", 0, 1),
		decayPerCoverage: num(issues, raw, "decayPerCoverage", "disasters.epidemic.decayPerCoverage", 0, 1),
		extinction: num(issues, raw, "extinction", "disasters.epidemic.extinction", 0, 1),
		mortality: num(issues, raw, "mortality", "disasters.epidemic.mortality", 0, 1),
		overload: num(issues, raw, "overload", "disasters.epidemic.overload", 0, 1),
		happiness: num(issues, raw, "happiness", "disasters.epidemic.happiness", 0, 255),
		happinessCity: num(issues, raw, "happinessCity", "disasters.epidemic.happinessCity", 0, 255)
	};
	if (raw && value.growth >= value.decay + value.decayPerCoverage) issues.push({
		field: "disasters.epidemic",
		message: `plné zdravotnictví musí nákazu srazit: růst ${value.growth} není míň než ústup ${value.decay + value.decayPerCoverage}`
	});
	return value;
}
function validateLandslide(issues, disasters) {
	const raw = disasterSection(issues, disasters, "landslide");
	return {
		lengthMin: num(issues, raw, "lengthMin", "disasters.landslide.lengthMin", 1, 64),
		lengthMax: num(issues, raw, "lengthMax", "disasters.landslide.lengthMax", 1, 64),
		widthMin: num(issues, raw, "widthMin", "disasters.landslide.widthMin", 1, 16),
		widthMax: num(issues, raw, "widthMax", "disasters.landslide.widthMax", 1, 16),
		happinessPerLoss: num(issues, raw, "happinessPerLoss", "disasters.landslide.happinessPerLoss", 0, 100),
		recentTerraformTicks: num(issues, raw, "recentTerraformTicks", "disasters.landslide.recentTerraformTicks", 0, 65535),
		builtWeight: num(issues, raw, "builtWeight", "disasters.landslide.builtWeight", 0, 10),
		freshTerraformWeight: num(issues, raw, "freshTerraformWeight", "disasters.landslide.freshTerraformWeight", 0, 10)
	};
}
function validateChemicalSpill(issues, disasters) {
	const raw = disasterSection(issues, disasters, "chemicalSpill");
	return {
		durationMin: num(issues, raw, "durationMin", "disasters.chemicalSpill.durationMin", 1, 500),
		durationMax: num(issues, raw, "durationMax", "disasters.chemicalSpill.durationMax", 1, 500),
		blastRadius: num(issues, raw, "blastRadius", "disasters.chemicalSpill.blastRadius", 0, 64),
		sourceDestroyChance: num(issues, raw, "sourceDestroyChance", "disasters.chemicalSpill.sourceDestroyChance", 0, 1),
		nearDestroyChance: num(issues, raw, "nearDestroyChance", "disasters.chemicalSpill.nearDestroyChance", 0, 1),
		pollutionRadius: num(issues, raw, "pollutionRadius", "disasters.chemicalSpill.pollutionRadius", 0, 64),
		pollution: num(issues, raw, "pollution", "disasters.chemicalSpill.pollution", 0, 255),
		waterRadius: num(issues, raw, "waterRadius", "disasters.chemicalSpill.waterRadius", 0, 64),
		waterAfterTicks: num(issues, raw, "waterAfterTicks", "disasters.chemicalSpill.waterAfterTicks", 0, 2e3),
		populationRadius: num(issues, raw, "populationRadius", "disasters.chemicalSpill.populationRadius", 0, 64),
		populationLoss: num(issues, raw, "populationLoss", "disasters.chemicalSpill.populationLoss", 0, 1),
		landValueRadius: num(issues, raw, "landValueRadius", "disasters.chemicalSpill.landValueRadius", 0, 64),
		landValue: num(issues, raw, "landValue", "disasters.chemicalSpill.landValue", 0, 255),
		landValueTicks: num(issues, raw, "landValueTicks", "disasters.chemicalSpill.landValueTicks", 1, 1e4),
		happiness: num(issues, raw, "happiness", "disasters.chemicalSpill.happiness", 0, 255),
		happinessCity: num(issues, raw, "happinessCity", "disasters.chemicalSpill.happinessCity", 0, 255),
		happinessPerLoss: num(issues, raw, "happinessPerLoss", "disasters.chemicalSpill.happinessPerLoss", 0, 255),
		heavyLevel: num(issues, raw, "heavyLevel", "disasters.chemicalSpill.heavyLevel", 1, 5),
		ageTicks: num(issues, raw, "ageTicks", "disasters.chemicalSpill.ageTicks", 1, 1e5),
		ageWeight: num(issues, raw, "ageWeight", "disasters.chemicalSpill.ageWeight", 0, 10),
		wasteWeight: num(issues, raw, "wasteWeight", "disasters.chemicalSpill.wasteWeight", 0, 100),
		neglectFactor: num(issues, raw, "neglectFactor", "disasters.chemicalSpill.neglectFactor", 0, 10)
	};
}
function validateBlast(issues, disasters) {
	const raw = disasters ? asRecord$1(disasters["blast"]) : null;
	if (!raw && disasters) issues.push({
		field: "disasters.blast",
		message: "chybí, nebo není objekt"
	});
	return {
		resistance: contentTable(issues, raw, "resistance", "disasters.blast.resistance", 1),
		explosion: blastKind(issues, raw, "explosion", "disasters.blast.explosion"),
		industrialAccident: blastKind(issues, raw, "industrialAccident", "disasters.blast.industrialAccident")
	};
}
//#endregion
//#region src/sim/layers.ts
/**
* Velikosti, které hra nabízí. Pořadí je pořadí v dialogu.
*
* `COARSE_FACTOR` zůstává 4, takže hrubá mřížka roste s mapou (512 → 128×128).
*/
var MAP_SIZES = [
	128,
	192,
	256,
	512
];
/**
* Hodnoty vrstvy `terrain`.
*
* Terén je **hratelný údaj, ne dekorace** (§2 zadání fáze 3): les se dá vykácet
* a do té doby zvedá cenu půdy a pohlcuje znečištění, mokřad se dá zavézt až
* s terraformingem, na skálu se bez srovnání nestaví.
*/
var TERRAIN = {
	grass: 0,
	water: 1,
	sand: 2,
	rock: 3,
	forest: 4,
	marsh: 5
};
/**
* Hodnoty vrstvy `road` (R11 zadání fáze 3).
*
* Do fáze 2 nesla vrstva jen 0/1. Typ silnice určuje kapacitu, cenu i údržbu —
* konkrétní čísla jsou v `balance.traffic.roadTypes`, kód zná jen pořadí.
*/
var ROAD = {
	none: 0,
	street: 1,
	avenue: 2,
	highway: 3
};
/** Hodnoty vrstvy `zone`. */
var ZONE = {
	none: 0,
	residential: 1,
	commercial: 2,
	industrial: 3
};
/**
* Index dlaždice ve vrstvě. `size` je hrana mapy — bere se z `world.size`.
*
* Parametr je **povinný schválně**: s výchozí hodnotou by se dalo zapomenout
* ho předat a mapa 512×512 by potichu četla po 128 dlaždicích. Takhle na každé
* zapomenuté místo ukáže překladač.
*/
function index(x, y, size) {
	return y * size + x;
}
function inBounds(x, y, size) {
	return x >= 0 && y >= 0 && x < size && y < size;
}
/**
* Hrana mapy odvozená z **délky vrstvy**.
*
* Vrstva je čtverec `size × size`, takže se velikost dá spočítat z ní — a
* nemůže se s daty rozejít. Používá to kód, který dostane jen pole a ne celý
* svět: generátor mapy, difuze, načítání savu. Stejný trik jako
* `cornerSideOf()` u mřížky rohů.
*/
function sizeOfLayer(layer) {
	return Math.round(Math.sqrt(layer.length));
}
function createLayers(size) {
	const cells = size * size;
	return {
		terrain: new Uint8Array(cells),
		zone: new Uint8Array(cells),
		road: new Uint8Array(cells),
		buildingId: new Uint16Array(cells),
		power: new Uint8Array(cells),
		pipe: new Uint8Array(cells)
	};
}
//#endregion
//#region src/content/schema.ts
/** `namespace` bez dvojtečky — viz `id` v manifestu. */
var NAMESPACE = /^[a-z][a-z0-9_]*$/;
/** `namespace:identifier` — P6. */
var DEFINITION_ID = /^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/;
var VERSION = /^\d+\.\d+\.\d+$/;
var COLOR = /^#[0-9a-f]{6}$/i;
var LOCALE_KEY = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
var TERRAIN_VALUES = new Set(Object.values(TERRAIN));
var GRANT_SECTIONS = [
	"id",
	"type",
	"name",
	"description",
	"amount",
	"condition"
];
var DEFINITION_SECTIONS = [
	"id",
	"type",
	"category",
	"menu",
	"name",
	"description",
	"footprint",
	"level",
	"construction",
	"economy",
	"population",
	"jobs",
	"service",
	"nuisance",
	"waste",
	"requirements",
	"power",
	"water",
	"sewage",
	"transit",
	"environment",
	"graphics"
];
function asRecord(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	return value;
}
function requireRecord(issues, container, key, field) {
	const record = asRecord(container[key]);
	if (!record) {
		issues.push({
			field,
			message: "musí být objekt"
		});
		return null;
	}
	return record;
}
function requireString(issues, container, key, field, pattern) {
	const value = container[key];
	if (typeof value !== "string" || value.length === 0) {
		issues.push({
			field,
			message: "musí být neprázdný řetězec"
		});
		return null;
	}
	if (pattern && !pattern.test(value)) {
		issues.push({
			field,
			message: `nemá očekávaný tvar ${String(pattern)}`
		});
		return null;
	}
	return value;
}
function requireInt(issues, container, key, field, min, max = Number.MAX_SAFE_INTEGER) {
	const value = container[key];
	if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
		issues.push({
			field,
			message: `musí být celé číslo v rozsahu ${min}–${max}`
		});
		return null;
	}
	return value;
}
function optionalInt(issues, container, key, field, min, max) {
	if (container[key] === void 0) return void 0;
	return requireInt(issues, container, key, field, min, max) ?? void 0;
}
/** Volitelný příznak; chybějící znamená `false`, ne chybu. */
function optionalBoolean(issues, container, key, field) {
	const value = container[key];
	if (value === void 0) return false;
	if (typeof value !== "boolean") {
		issues.push({
			field,
			message: "musí být true nebo false"
		});
		return false;
	}
	return value;
}
function requireBoolean(issues, container, key, field) {
	const value = container[key];
	if (typeof value !== "boolean") {
		issues.push({
			field,
			message: "musí být true nebo false"
		});
		return null;
	}
	return value;
}
function validateManifest(raw) {
	const issues = [];
	const record = asRecord(raw);
	if (!record) return {
		manifest: null,
		issues: [{
			field: "",
			message: "manifest musí být objekt"
		}]
	};
	const id = requireString(issues, record, "id", "id", NAMESPACE);
	const name = requireString(issues, record, "name", "name");
	const version = requireString(issues, record, "version", "version", VERSION);
	const gameVersion = requireString(issues, record, "gameVersion", "gameVersion");
	const rawDependencies = record["dependencies"];
	let dependencies = null;
	if (!Array.isArray(rawDependencies)) issues.push({
		field: "dependencies",
		message: "musí být pole (klidně prázdné)"
	});
	else {
		dependencies = [];
		rawDependencies.forEach((entry, i) => {
			if (typeof entry !== "string" || entry.length === 0) issues.push({
				field: `dependencies[${i}]`,
				message: "musí být neprázdný řetězec"
			});
			else dependencies?.push(entry);
		});
	}
	if (issues.length > 0 || !id || !name || !version || !gameVersion || !dependencies) return {
		manifest: null,
		issues
	};
	return {
		manifest: {
			id,
			name,
			version,
			gameVersion,
			dependencies
		},
		issues
	};
}
/**
* `expectedNamespace` je `id` z manifestu zdroje. Definice musí patřit svému
* zdroji — jinak by mod mohl nechtěně přepsat cizí obsah.
*/
function validateDefinition(raw, expectedNamespace) {
	const issues = [];
	const record = asRecord(raw);
	if (!record) return {
		definition: null,
		issues: [{
			field: "",
			message: "definice musí být objekt"
		}]
	};
	const type = record["type"];
	if (type !== "building" && type !== "grant") return {
		definition: null,
		issues: [{
			field: "type",
			message: "podporováno je \"building\" a \"grant\""
		}]
	};
	const sections = type === "grant" ? GRANT_SECTIONS : DEFINITION_SECTIONS;
	for (const key of Object.keys(record).sort()) if (!sections.includes(key)) issues.push({
		field: key,
		message: "neznámá sekce — překlep?"
	});
	const id = requireString(issues, record, "id", "id", DEFINITION_ID);
	if (id && !id.startsWith(`${expectedNamespace}:`)) issues.push({
		field: "id",
		message: `musí začínat namespace zdroje "${expectedNamespace}:"`
	});
	if (type === "grant") return validateGrant(issues, record, id);
	const category = requireString(issues, record, "category", "category", NAMESPACE);
	let menu;
	if (record["menu"] !== void 0) menu = requireString(issues, record, "menu", "menu", NAMESPACE) ?? void 0;
	const name = requireString(issues, record, "name", "name", LOCALE_KEY);
	const description = requireString(issues, record, "description", "description", LOCALE_KEY);
	const footprint = validateFootprint(issues, record["footprint"]);
	const level = record["level"] === void 0 ? 1 : requireInt(issues, record, "level", "level", 1, 5);
	const construction = validateConstruction(issues, record);
	const economy = validateEconomy(issues, record);
	const graphics = validateGraphics(issues, record);
	const power = validatePower(issues, record);
	const water = validateWater(issues, record);
	const sewage = validateSewage(issues, record);
	const transit = validateTransit(issues, record);
	const environment = validateEnvironment(issues, record);
	const population = validateCapacity(issues, record, "population");
	const jobs = validateCapacity(issues, record, "jobs");
	const service = validateService(issues, record);
	const nuisance = validateService(issues, record, "nuisance");
	const waste = validateWaste(issues, record);
	const requirements = validateRequirements(issues, record);
	if (issues.length > 0 || !id || !category || !name || !description || !footprint || level === null || !construction || !economy || !graphics) return {
		definition: null,
		issues
	};
	return {
		definition: {
			id,
			type: "building",
			category,
			...menu === void 0 ? {} : { menu },
			name,
			description,
			footprint,
			level,
			construction,
			economy,
			...population ? { population } : {},
			...jobs ? { jobs } : {},
			...service ? { service } : {},
			...nuisance ? { nuisance } : {},
			...waste ? { waste } : {},
			...requirements ? { requirements } : {},
			...power ? { power } : {},
			...water ? { water } : {},
			...sewage ? { sewage } : {},
			...transit ? { transit } : {},
			...environment ? { environment } : {},
			graphics
		},
		issues
	};
}
function validateFootprint(issues, raw) {
	if (!Array.isArray(raw) || raw.length !== 2) {
		issues.push({
			field: "footprint",
			message: "musí být pole [šířka, výška]"
		});
		return null;
	}
	const holder = {
		w: raw[0],
		h: raw[1]
	};
	const w = requireInt(issues, holder, "w", "footprint[0]", 1, 16);
	const h = requireInt(issues, holder, "h", "footprint[1]", 1, 16);
	return w !== null && h !== null ? [w, h] : null;
}
function validateConstruction(issues, record) {
	const section = requireRecord(issues, record, "construction", "construction");
	if (!section) return null;
	const cost = requireInt(issues, section, "cost", "construction.cost", 0);
	const requiresRoad = requireBoolean(issues, section, "requiresRoad", "construction.requiresRoad");
	const requiresPower = requireBoolean(issues, section, "requiresPower", "construction.requiresPower");
	const rawTerrain = section["allowedTerrain"];
	let allowedTerrain = null;
	if (!Array.isArray(rawTerrain) || rawTerrain.length === 0) issues.push({
		field: "construction.allowedTerrain",
		message: "musí být neprázdné pole hodnot vrstvy terrain"
	});
	else {
		allowedTerrain = [];
		rawTerrain.forEach((value, i) => {
			if (typeof value !== "number" || !TERRAIN_VALUES.has(value)) issues.push({
				field: `construction.allowedTerrain[${i}]`,
				message: "není platná hodnota vrstvy terrain"
			});
			else allowedTerrain?.push(value);
		});
	}
	if (cost === null || requiresRoad === null || requiresPower === null || !allowedTerrain) return null;
	const requiresWater = optionalBoolean(issues, section, "requiresWater", "construction.requiresWater");
	const nearWater = optionalBoolean(issues, section, "nearWater", "construction.nearWater");
	const allowsSlope = optionalBoolean(issues, section, "allowsSlope", "construction.allowsSlope");
	return {
		cost,
		requiresRoad,
		requiresPower,
		...requiresWater ? { requiresWater } : {},
		...nearWater ? { nearWater } : {},
		...allowsSlope ? { allowsSlope } : {},
		allowedTerrain
	};
}
function validateEconomy(issues, record) {
	const section = requireRecord(issues, record, "economy", "economy");
	if (!section) return null;
	const upkeep = requireInt(issues, section, "upkeep", "economy.upkeep", 0);
	return upkeep === null ? null : { upkeep };
}
function validateGraphics(issues, record) {
	const section = requireRecord(issues, record, "graphics", "graphics");
	if (!section) return null;
	const color = requireString(issues, section, "color", "graphics.color", COLOR);
	const heightLevels = requireInt(issues, section, "heightLevels", "graphics.heightLevels", 1, 15);
	let icon;
	if (section["icon"] !== void 0) icon = requireString(issues, section, "icon", "graphics.icon", NAMESPACE) ?? void 0;
	if (color === null || heightLevels === null) return null;
	return icon === void 0 ? {
		color,
		heightLevels
	} : {
		color,
		heightLevels,
		icon
	};
}
/** Sekce `population` a `jobs` mají stejný tvar `{ capacity }`. */
function validateCapacity(issues, record, key) {
	if (record[key] === void 0) return void 0;
	const section = requireRecord(issues, record, key, key);
	if (!section) return void 0;
	const capacity = requireInt(issues, section, "capacity", `${key}.capacity`, 0, 65535);
	return capacity === null ? void 0 : { capacity };
}
function validateService(issues, record, field = "service") {
	if (record[field] === void 0) return void 0;
	const section = requireRecord(issues, record, field, field);
	if (!section) return void 0;
	const serviceClass = requireString(issues, section, "class", `${field}.class`, NAMESPACE);
	const radius = requireInt(issues, section, "radius", `${field}.radius`, 1, 32);
	const strength = requireInt(issues, section, "strength", `${field}.strength`, 1, 255);
	return serviceClass !== null && radius !== null && strength !== null ? {
		class: serviceClass,
		radius,
		strength
	} : void 0;
}
function validateWaste(issues, record) {
	if (record["waste"] === void 0) return void 0;
	const section = requireRecord(issues, record, "waste", "waste");
	if (!section) return void 0;
	const capacity = requireInt(issues, section, "capacity", "waste.capacity", 1, 65535);
	return capacity === null ? void 0 : { capacity };
}
/**
* Prerekvizity (§7). Obě části jsou volitelné, ale co je uvedené, musí mít
* správný tvar — jinak by se překlep ve třídě služby projevil jako budova,
* která nikdy nevyroste, a nikdo by nevěděl proč.
*/
function validateRequirements(issues, record) {
	if (record["requirements"] === void 0) return void 0;
	const section = requireRecord(issues, record, "requirements", "requirements");
	if (!section) return void 0;
	const services = {};
	if (section["services"] !== void 0) {
		const raw = requireRecord(issues, section, "services", "requirements.services");
		for (const key of Object.keys(raw ?? {}).sort()) {
			if (!NAMESPACE.test(key)) {
				issues.push({
					field: `requirements.services.${key}`,
					message: "není platné jméno třídy"
				});
				continue;
			}
			const value = requireInt(issues, raw ?? {}, key, `requirements.services.${key}`, 0, 255);
			if (value !== null) services[key] = value;
		}
	}
	const buildings = [];
	if (section["buildings"] !== void 0) {
		const raw = section["buildings"];
		if (!Array.isArray(raw)) issues.push({
			field: "requirements.buildings",
			message: "musí být pole id definic"
		});
		else raw.forEach((entry, i) => {
			if (typeof entry !== "string" || !DEFINITION_ID.test(entry)) issues.push({
				field: `requirements.buildings[${i}]`,
				message: "musí být id definice s namespace"
			});
			else buildings.push(entry);
		});
	}
	return {
		services,
		buildings
	};
}
function validatePower(issues, record) {
	if (record["power"] === void 0) return void 0;
	const section = requireRecord(issues, record, "power", "power");
	if (!section) return void 0;
	const production = optionalInt(issues, section, "production", "power.production", 0);
	const consumption = optionalInt(issues, section, "consumption", "power.consumption", 0);
	if (production === void 0 && consumption === void 0) issues.push({
		field: "power",
		message: "musí mít production nebo consumption"
	});
	return {
		...production !== void 0 ? { production } : {},
		...consumption !== void 0 ? { consumption } : {}
	};
}
function validateWater(issues, record) {
	if (record["water"] === void 0) return void 0;
	const section = requireRecord(issues, record, "water", "water");
	if (!section) return void 0;
	const production = optionalInt(issues, section, "production", "water.production", 0);
	const consumption = optionalInt(issues, section, "consumption", "water.consumption", 0);
	const range = optionalInt(issues, section, "range", "water.range", 0);
	if (production === void 0 && consumption === void 0 && range === void 0) issues.push({
		field: "water",
		message: "musí mít production, consumption nebo range"
	});
	return {
		...production !== void 0 ? { production } : {},
		...consumption !== void 0 ? { consumption } : {},
		...range !== void 0 ? { range } : {}
	};
}
function validateSewage(issues, record) {
	if (record["sewage"] === void 0) return void 0;
	const section = requireRecord(issues, record, "sewage", "sewage");
	if (!section) return void 0;
	const capacity = requireInt(issues, section, "capacity", "sewage.capacity", 0);
	return capacity === null ? void 0 : { capacity };
}
/**
* Grant. Kontroluje se **tvar podmínky**, ne jméno veličiny.
*
* Neznámá veličina se pozná až za běhu, kdy se na ni nikdo neumí zeptat —
* a to je záměr: mod si smí přidat vlastní veličinu a hra ji nesmí odmítnout
* jen proto, že o ní neví. Chybějící `amount` nebo `atLeast` je ale překlep,
* ne rozšíření, a tichý grant za nula korun nikdo neodhalí.
*/
function validateGrant(issues, record, id) {
	const name = requireString(issues, record, "name", "name", LOCALE_KEY);
	const description = requireString(issues, record, "description", "description", LOCALE_KEY);
	const amount = requireInt(issues, record, "amount", "amount", 1);
	const section = requireRecord(issues, record, "condition", "condition");
	const metric = section ? requireString(issues, section, "metric", "condition.metric", NAMESPACE) : null;
	const atLeast = section ? requireInt(issues, section, "atLeast", "condition.atLeast", 0) : null;
	let definitionId;
	if (section && section["definitionId"] !== void 0) definitionId = requireString(issues, section, "definitionId", "condition.definitionId", DEFINITION_ID) ?? void 0;
	let forTicks;
	if (section && section["forTicks"] !== void 0) forTicks = requireInt(issues, section, "forTicks", "condition.forTicks", 1) ?? void 0;
	if (issues.length > 0 || !id || !name || !description || amount === null || !metric || atLeast === null) return {
		definition: null,
		issues
	};
	return {
		definition: {
			id,
			type: "grant",
			name,
			description,
			amount,
			condition: {
				metric,
				atLeast,
				...definitionId !== void 0 ? { definitionId } : {},
				...forTicks !== void 0 ? { forTicks } : {}
			}
		},
		issues
	};
}
function validateTransit(issues, record) {
	if (record["transit"] === void 0) return void 0;
	const section = requireRecord(issues, record, "transit", "transit");
	if (!section) return void 0;
	const mode = requireString(issues, section, "mode", "transit.mode");
	return mode === null ? void 0 : { mode };
}
function validateEnvironment(issues, record) {
	if (record["environment"] === void 0) return void 0;
	const section = requireRecord(issues, record, "environment", "environment");
	if (!section) return void 0;
	const pollution = optionalInt(issues, section, "pollution", "environment.pollution", 0, 255);
	return pollution !== void 0 ? { pollution } : {};
}
//#endregion
//#region src/content/registry.ts
/** Nevalidní obsah je chyba s uvedením zdroje, nikdy tichý pád (§7). */
var ContentValidationError = class extends Error {
	problems;
	constructor(label, problems) {
		super(`Nevalidní obsah ve zdroji ${label}:\n- ${problems.join("\n- ")}`);
		this.name = "ContentValidationError";
		this.problems = problems;
	}
};
function describe(file, issues) {
	return issues.map((issue) => `${file}: ${issue.field || "(kořen)"} — ${issue.message}`);
}
var ContentRegistry = class {
	definitions = /* @__PURE__ */ new Map();
	grantDefs = /* @__PURE__ */ new Map();
	sources = [];
	/** jazyk → klíč → text, slito přes všechny zdroje (§10). */
	locales = /* @__PURE__ */ new Map();
	/** jméno ikony → URL obrázku, slito přes všechny zdroje. */
	icons = /* @__PURE__ */ new Map();
	sprites = /* @__PURE__ */ new Map();
	tiles = /* @__PURE__ */ new Map();
	balance = null;
	/**
	* Načte zdroj. Buď projde celý, nebo se nezaregistruje nic — částečně
	* načtený mod je horší než žádný, protože chyba vypluje až za hodinu hraní.
	*/
	async load(source) {
		const problems = [];
		const { manifest, issues: manifestIssues } = validateManifest(source.manifest);
		problems.push(...describe("manifest.json", manifestIssues));
		if (!manifest) throw new ContentValidationError(source.label, problems);
		if (this.sources.some((existing) => existing.id === manifest.id)) throw new ContentValidationError(source.label, [`manifest.json: id — zdroj "${manifest.id}" už je načtený`]);
		let incomingBalance = null;
		if (source.balance !== void 0) {
			const result = validateBalance(source.balance);
			problems.push(...describe("balance.json", result.issues));
			incomingBalance = result.balance;
		}
		const incomingLocales = collectLocales(source, problems);
		const knownKeys = /* @__PURE__ */ new Set();
		for (const table of incomingLocales.values()) for (const key of table.keys()) knownKeys.add(key);
		const accepted = /* @__PURE__ */ new Map();
		for (const file of source.definitions) {
			const { definition, issues } = validateDefinition(file.data, manifest.id);
			problems.push(...describe(file.path, issues));
			if (!definition) continue;
			if (this.definitions.has(definition.id) || this.grantDefs.has(definition.id) || accepted.has(definition.id)) {
				problems.push(`${file.path}: id — "${definition.id}" je už definované`);
				continue;
			}
			for (const key of [definition.name, definition.description]) if (!knownKeys.has(key)) problems.push(`${file.path}: lokalizační klíč "${key}" nemá překlad v žádném jazyce`);
			accepted.set(definition.id, definition);
		}
		if (problems.length > 0) throw new ContentValidationError(source.label, problems);
		for (const [id, definition] of accepted) if (definition.type === "grant") this.grantDefs.set(id, definition);
		else this.definitions.set(id, definition);
		if (incomingBalance) this.balance = incomingBalance;
		for (const [name, url] of Object.entries(source.icons ?? {})) this.icons.set(name, url);
		for (const [key, sprite] of Object.entries(source.sprites ?? {})) this.sprites.set(key, sprite);
		for (const [key, url] of Object.entries(source.tiles ?? {})) this.tiles.set(key, url);
		for (const [language, table] of incomingLocales) {
			const target = this.locales.get(language) ?? /* @__PURE__ */ new Map();
			for (const [key, text] of table) target.set(key, text);
			this.locales.set(language, target);
		}
		this.sources.push({
			id: manifest.id,
			name: manifest.name,
			version: manifest.version
		});
	}
	/**
	* Balanc posledního zdroje, který ho dodal. Bez něj hra běžet nemůže —
	* tichý default by znamenal, že se hra chová jinak, než balanc popisuje.
	*/
	getBalance() {
		if (!this.balance) throw new ContentValidationError("balance", ["žádný načtený zdroj nedodal balance.json"]);
		return this.balance;
	}
	/** Jazyky, ke kterým existuje aspoň jeden text. Seřazené, ať je pořadí stabilní. */
	getLanguages() {
		return [...this.locales.keys()].sort();
	}
	/**
	* URL obrázků ikon. Prázdné, když je žádný zdroj nedodal — rozhraní si pak
	* poradí polygony.
	*/
	getIcons() {
		return Object.fromEntries(this.icons);
	}
	/**
	* Obrázek budovy, nebo `undefined`. Bez něj renderer kreslí kvádr jako dřív —
	* chybějící obrázek je vzhled, ne podmínka běhu.
	*/
	getSprite(definitionId, variant) {
		return this.sprites.get(`${definitionId}|${variant}`);
	}
	/** URL obrázku povrchu, nebo `undefined`, když ho obsah nedodal. */
	getTile(terrain, variant) {
		return this.tiles.get(`${terrain}|${variant}`);
	}
	/** Varianty, ke kterým povrch obrázek má. Seřazené, ať je losování stabilní. */
	getTileVariants(terrain) {
		const prefix = `${terrain}|`;
		return [...this.tiles.keys()].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)).sort();
	}
	/**
	* Varianty, ke kterým budova obrázek má. Seřazené, ať je pořadí stabilní —
	* losovat se z nich bude přes `world.rng` a nesmí to záviset na pořadí,
	* v jakém glob vrátil soubory (P2).
	*/
	getSpriteVariants(definitionId) {
		const prefix = `${definitionId}|`;
		return [...this.sprites.keys()].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)).sort();
	}
	getLocaleTable(language) {
		return Object.fromEntries(this.locales.get(language) ?? []);
	}
	get(id) {
		return this.definitions.get(id);
	}
	/** Pořadí je pořadí načtení — stabilní, takže se o něj smí opřít i simulace. */
	/**
	* Granty v pevném pořadí podle id.
	*
	* Pořadí je součást determinismu: přiznávají se v tomtéž tiku a každý přidá
	* peníze, takže na pořadí by jinak záleželo podle toho, jak glob vrátil
	* soubory (P2).
	*/
	grants() {
		return [...this.grantDefs.values()].sort((a, b) => a.id.localeCompare(b.id));
	}
	getGrant(id) {
		return this.grantDefs.get(id);
	}
	getAll(type) {
		return [...this.definitions.values()].filter((definition) => definition.type === type);
	}
	/**
	* Budovy dané kategorie. Simulace si tudy sahá pro obsah, aniž by věděla,
	* jaké konkrétní budovy existují (P5).
	*/
	byCategory(category) {
		return this.getAll("building").filter((definition) => definition.category === category);
	}
	getLoadedSources() {
		return this.sources.map((source) => ({ ...source }));
	}
};
function collectLocales(source, problems) {
	const locales = /* @__PURE__ */ new Map();
	for (const language of Object.keys(source.locales).sort()) {
		const table = source.locales[language];
		if (typeof table !== "object" || table === null || Array.isArray(table)) {
			problems.push(`locale/${language}.json: musí být plochý objekt klíč → text`);
			continue;
		}
		const entries = /* @__PURE__ */ new Map();
		for (const [key, value] of Object.entries(table)) {
			if (typeof value !== "string") {
				problems.push(`locale/${language}.json: ${key} — hodnota musí být řetězec`);
				continue;
			}
			entries.set(key, value);
		}
		locales.set(language, entries);
	}
	return locales;
}
/**
* Hrana hrubé mřížky pro mapu o hraně `size`.
*
* Faktor zůstává 4 i u velkých map (§2 fáze 4), takže mřížka roste s nimi:
* 128 → 32 buněk, 512 → 128. Difuze tím zůstává stejně jemná bez ohledu na
* velikost města.
*/
function coarseSizeOf(size) {
	return Math.ceil(size / 4);
}
function coarseCellsOf(size) {
	const side = coarseSizeOf(size);
	return side * side;
}
/** Buňka hrubé mřížky pro dlaždici v plném rozlišení. `size` je hrana mapy. */
function coarseIndex(x, y, size) {
	return (y / 4 | 0) * coarseSizeOf(size) + (x / 4 | 0);
}
/** `coarseSize` je hrana **hrubé** mřížky, ne mapy. */
function coarseInBounds(cellX, cellY, coarseSize) {
	return cellX >= 0 && cellY >= 0 && cellX < coarseSize && cellY < coarseSize;
}
function createCoarseLayers(size) {
	const cells = coarseCellsOf(size);
	return {
		pollution: new Uint8Array(cells),
		landValue: new Uint8Array(cells),
		crime: new Uint8Array(cells)
	};
}
//#endregion
//#region src/sim/disasters/state.ts
function createDisasterState(enabled = true) {
	return {
		enabled,
		lastOccurrence: /* @__PURE__ */ new Map(),
		active: [],
		modifiers: [],
		nextId: 1,
		riskCeiling: /* @__PURE__ */ new Map(),
		burning: {
			normal: 0,
			wildfire: 0
		},
		offlinePlants: /* @__PURE__ */ new Set()
	};
}
//#endregion
//#region src/sim/rng.ts
/**
* Mulberry32 se serializovatelným stavem (P2).
*
* `getState` / `fromState` jsou nutné, aby byl RNG součástí savu — bez nich by
* načtená hra pokračovala jinou posloupností než ta uložená a determinismus by
* platil jen do prvního loadu.
*
* Algoritmus se nesmí měnit: změna rozbije všechny existující savy i golden testy.
* Hlídá to `tests/rng.test.ts` hardcoded snapshotem.
*/
var Rng = class Rng {
	state;
	constructor(seed) {
		this.state = seed >>> 0;
	}
	/** Rovnoměrné číslo v <0, 1). */
	next() {
		this.state = this.state + 1831565813 >>> 0;
		let t = this.state;
		t = Math.imul(t ^ t >>> 15, t | 1);
		t ^= t + Math.imul(t ^ t >>> 7, t | 61);
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	}
	/** Celé číslo v <0, maxExclusive). */
	int(maxExclusive) {
		return Math.floor(this.next() * maxExclusive);
	}
	getState() {
		return this.state;
	}
	static fromState(state) {
		const rng = new Rng(0);
		rng.state = state >>> 0;
		return rng;
	}
};
//#endregion
//#region src/sim/disasters/rubble.ts
/**
* Trosky (R15 fáze 4).
*
* **Vrstva, ne stav budovy** — a je to rozhodnutí, ne detail. Trosky zůstanou
* i tam, kde žádná budova nestála: po zničené silnici, po prokopaném potrubí,
* po dlaždici, kterou přejelo tornádo. Kdyby byly příznakem budovy, půlka
* katastrof by po sobě neuklidila vůbec nic.
*
* Chovají se jako opuštěné budovy z fáze 2: srážejí cenu půdy a živí
* kriminalitu. Hlavně ale **blokují stavbu**, dokud je hráč nezbourá — z toho
* plyne jediná věc, kterou po katastrofě musí zaplatit, a tím pádem i
* rozhodnutí, kterou čtvrť obnovit dřív.
*/
/**
* Zanechá trosky na dlaždici.
*
* Bez kontroly, jestli tam už jsou: zapsat jedničku podruhé je totéž co
* poprvé a `dirty.tiles` je množina, takže se ani překreslení nezdvojí.
* Stráž by byla řádek, který nejde porušit — a tím pádem ani otestovat.
*
* `definitionId` je **co na dlaždici stálo**. Zapisuje se do `rubbleOf`, aby
* hráč po katastrofě poznal, že tady byla nemocnice, a ne jen že tu je hromada
* suti. Nahlásil to autor: po vyhořelém městě se nedalo zjistit, co kde bylo,
* takže obnova byla hádání. Silnice ani potrubí id nemají a nepotřebují —
* hromada po silnici vypadá jako hromada a hráč silnici najde podle sousedů.
*/
function spawnRubble(world, tile, definitionId) {
	world.rubble[tile] = 1;
	if (definitionId !== void 0) world.rubbleOf.set(tile, definitionId);
	markTileAt$2(world, tile);
}
/**
* Kolik trosek leží v které buňce hrubé mřížky.
*
* Cena půdy i kriminalita žijí na hrubé mřížce, trosky na plné. Průchod se
* dělá **jednou za běh** a výsledek se předá dál; kdyby si ho každá z 16 384
* buněk počítala sama, byl by z toho průchod čtvrt milionem dlaždic pro každou.
*/
function rubblePerCell(world) {
	const coarse = coarseSizeOf(world.size);
	const counts = new Float32Array(coarse * coarse);
	for (let tile = 0; tile < world.rubble.length; tile++) {
		if ((world.rubble[tile] ?? 0) === 0) continue;
		const x = tile % world.size;
		const cell = coarseIndex(x, (tile - x) / world.size, world.size);
		counts[cell] = (counts[cell] ?? 0) + 1;
	}
	return counts;
}
function markTileAt$2(world, tile) {
	const x = tile % world.size;
	markTileDirty(world, x, (tile - x) / world.size);
}
//#endregion
//#region src/sim/disasters/flood.ts
/** Je dlaždice pod vodou? Ptá se na to elektřina, vodovod i doprava. */
function isFlooded(world, tile) {
	return (world.flood[tile] ?? 0) > 0;
}
/**
* Podíl každé buňky hrubé mřížky, který je pod vodou.
*
* Cena půdy žije na hrubé mřížce, voda na plné. Průchod se dělá **jednou za
* běh** a výsledek se předá dál — kdyby si ho počítala každá buňka sama, byl
* by z toho průchod čtvrt milionem dlaždic pro každou z šestnácti tisíc.
*/
function floodPerCell(world) {
	const coarse = coarseSizeOf(world.size);
	const counts = new Float32Array(coarse * coarse);
	for (let tile = 0; tile < world.flood.length; tile++) {
		if ((world.flood[tile] ?? 0) === 0) continue;
		const cell = cellOf$1(world, tile);
		counts[cell] = (counts[cell] ?? 0) + 1 / 16;
	}
	return counts;
}
/** Voda opadla. Poškození zůstává — sesbírané škody se odpuštěním vody nemažou. */
function drainTile(world, tile) {
	if ((world.flood[tile] ?? 0) === 0 && (world.floodDepth[tile] ?? 0) === 0) return;
	world.flood[tile] = 0;
	world.floodDepth[tile] = 0;
	markTileAt$1(world, tile);
}
/**
* Systém záplavy. Běží každý tik — voda opadá plynule, ne po skocích.
*
* Dlaždice se procházejí vzestupně podle indexu; náhoda se tu nepoužívá vůbec,
* takže determinismus (P2) drží sám od sebe.
*/
function createFloodSystem(catalogue, balance) {
	return {
		name: "flood",
		interval: 1,
		offset: 0,
		run(world) {
			const flood = balance.disasters.flood;
			const coverage = world.coverage.get("fire");
			const destroyed = [];
			let wet = 0;
			for (let tile = 0; tile < world.flood.length; tile++) {
				const left = world.flood[tile] ?? 0;
				if (left === 0) continue;
				wet++;
				const depth = world.floodDepth[tile] ?? 0;
				const cell = cellOf$1(world, tile);
				world.coarse.pollution[cell] = clampByte$1((world.coarse.pollution[cell] ?? 0) + flood.pollutionPerTick);
				const damage = (world.floodDamage[tile] ?? 0) + depth * flood.damagePerDepth;
				if (damage >= 255) {
					world.floodDamage[tile] = 255;
					destroyed.push(tile);
				} else world.floodDamage[tile] = clampByte$1(damage);
				const remaining = left - (1 + (coverage?.[cell] ?? 0) * flood.drainPerCoverage);
				if (remaining <= 0) drainTile(world, tile);
				else world.flood[tile] = clampByte$1(remaining);
			}
			if (destroyed.length > 0) washAway(world, catalogue, balance, destroyed);
			if (wet > 0) world.dirty.coarseChanged = true;
		}
	};
}
/**
* Dlaždice, které voda dobila.
*
* Budova mizí celá i s půdorysem, stejně jako u ohně. Zaplavená silnice a
* potrubí zmizí taky — a po všem zůstanou trosky, takže obnova stojí peníze
* i čas.
*/
function washAway(world, catalogue, balance, tiles) {
	const doomed = /* @__PURE__ */ new Set();
	let lost = 0;
	for (const tile of tiles) {
		const buildingId = world.layers.buildingId[tile] ?? 0;
		if (buildingId !== 0) {
			doomed.add(buildingId);
			continue;
		}
		if ((world.layers.road[tile] ?? 0) !== 0 || (world.layers.pipe[tile] ?? 0) !== 0) {
			world.layers.road[tile] = 0;
			world.roadTiles.delete(tile);
			world.layers.pipe[tile] = 0;
			world.powerNetworkDirty = true;
			world.waterNetworkDirty = true;
			spawnRubble(world, tile);
			markTileAt$1(world, tile);
		}
	}
	for (const id of [...doomed].sort((a, b) => a - b)) {
		const building = world.buildings.get(id);
		if (!building) continue;
		const [width, depth] = catalogue.get(building.definitionId)?.footprint ?? [1, 1];
		for (let dy = 0; dy < depth; dy++) for (let dx = 0; dx < width; dx++) {
			const x = building.x + dx;
			const y = building.y + dy;
			if (x >= world.size || y >= world.size) continue;
			spawnRubble(world, index(x, y, world.size), building.definitionId);
		}
		if (removeBuilding(world, id)) lost++;
	}
	const penalty = balance.disasters.flood.happinessPerLoss;
	if (lost > 0 && penalty > 0) world.disasters.modifiers.push({
		kind: "happinessPenalty",
		cells: [],
		amount: penalty * lost,
		until: world.tick + balance.disasters.fire.happinessPenaltyTicks,
		source: 0
	});
}
function cellOf$1(world, tile) {
	const x = tile % world.size;
	return coarseIndex(x, (tile - x) / world.size, world.size);
}
function markTileAt$1(world, tile) {
	const x = tile % world.size;
	markTileDirty(world, x, (tile - x) / world.size);
}
function clampByte$1(value) {
	return Math.max(0, Math.min(255, Math.round(value)));
}
//#endregion
//#region src/sim/systems/power.ts
/**
* Elektřina ve dvou krocích.
*
* 1. **Topologie** — flood fill z elektráren po vodičích do vrstvy `power`.
*    Vodičem je silnice a budova; samostatné elektrické vedení fáze 1 nemá.
* 2. **Kapacita** — připojeným budovám se rozdává výroba podle `id`, tedy od
*    nejstarší. Když výroba nestačí, zbytek zůstane bez proudu.
*
* Systém běží každý tik (§5), ale flood fill pouští jen když se síť změnila.
* Bez toho by se 16 384 dlaždic procházelo čtyřikrát za sekundu pro nic.
*/
function createPowerSystem(catalogue) {
	return {
		name: "power",
		interval: 1,
		offset: 0,
		run(world) {
			if (!world.powerNetworkDirty) return;
			world.powerNetworkDirty = false;
			recompute$1(world, catalogue);
		}
	};
}
function recompute$1(world, catalogue) {
	const ids = [...world.buildings.keys()].sort((a, b) => a - b);
	const reached = new Uint8Array(world.layers.power.length);
	const queue = [];
	let production = 0;
	for (const id of ids) {
		const building = world.buildings.get(id);
		if (!building) continue;
		const definition = catalogue.get(building.definitionId);
		const produced = definition?.power?.production ?? 0;
		if (!definition || produced <= 0) continue;
		if (world.disasters.offlinePlants.has(id)) continue;
		production += produced;
		const [width, depth] = definition.footprint;
		for (let dy = 0; dy < depth; dy++) for (let dx = 0; dx < width; dx++) {
			const tile = index(building.x + dx, building.y + dy, world.size);
			if (reached[tile] === 0) {
				reached[tile] = 1;
				queue.push(tile);
			}
		}
	}
	floodFill$1(world, reached, queue);
	writePowerLayer(world, reached);
	distributeCapacity(world, catalogue, ids, production);
}
function floodFill$1(world, reached, queue) {
	const size = world.size;
	const { road, buildingId } = world.layers;
	const visit = (x, y) => {
		if (x < 0 || y < 0 || x >= size || y >= size) return;
		const tile = index(x, y, size);
		if (reached[tile] !== 0) return;
		if (road[tile] === 0 && buildingId[tile] === 0) return;
		if (isFlooded(world, tile)) return;
		reached[tile] = 1;
		queue.push(tile);
	};
	while (queue.length > 0) {
		const tile = queue.pop();
		if (tile === void 0) break;
		const x = tile % size;
		const y = (tile - x) / size;
		visit(x, y - 1);
		visit(x + 1, y);
		visit(x, y + 1);
		visit(x - 1, y);
	}
}
function writePowerLayer(world, reached) {
	const power = world.layers.power;
	for (let tile = 0; tile < power.length; tile++) {
		const next = reached[tile] === 1 ? 1 : 0;
		if (power[tile] === next) continue;
		power[tile] = next;
		const x = tile % world.size;
		markTileDirty(world, x, (tile - x) / world.size);
	}
}
function distributeCapacity(world, catalogue, ids, production) {
	let remaining = production;
	for (const id of ids) {
		const building = world.buildings.get(id);
		if (!building) continue;
		const definition = catalogue.get(building.definitionId);
		const consumption = definition?.power?.consumption ?? 0;
		const connected = isConnected(world, building.x, building.y, definition?.footprint);
		let powered = false;
		if (connected && !building.abandoned) {
			if (consumption === 0) powered = true;
			else if (remaining >= consumption) {
				powered = true;
				remaining -= consumption;
			}
		}
		if (building.powered !== powered) {
			building.powered = powered;
			markBuildingDirty(world, id);
			if (definition?.service) markCoverageDirty(world);
		}
	}
}
function isConnected(world, x, y, footprint) {
	const [width, depth] = footprint ?? [1, 1];
	for (let dy = 0; dy < depth; dy++) for (let dx = 0; dx < width; dx++) {
		const tileX = x + dx;
		const tileY = y + dy;
		if (tileX >= world.size || tileY >= world.size) continue;
		if (world.layers.power[index(tileX, tileY, world.size)] === 1) return true;
	}
	return false;
}
//#endregion
//#region src/sim/disasters/effects.ts
/**
* Zahodí postihy, kterým vypršel čas.
*
* Volá se jednou za tik z plánovače. Kdyby se čistilo až při čtení, seznam by
* u dlouhé hry rostl donekonečna.
*/
function expireModifiers(world) {
	const modifiers = world.disasters.modifiers;
	let write = 0;
	for (let read = 0; read < modifiers.length; read++) {
		const modifier = modifiers[read];
		if (!modifier || modifier.until <= world.tick) continue;
		modifiers[write++] = modifier;
	}
	modifiers.length = write;
}
/** Zruší postihy, které zavedla daná katastrofa. Volá se, když skončí. */
function clearModifiersOf(world, source) {
	const modifiers = world.disasters.modifiers;
	let write = 0;
	for (let read = 0; read < modifiers.length; read++) {
		const modifier = modifiers[read];
		if (!modifier || modifier.source === source) continue;
		modifiers[write++] = modifier;
	}
	modifiers.length = write;
}
/**
* Nejsilnější postih daného druhu pro buňku, nebo `fallback`, když žádný není.
*
* Postihy se **neskládají**. Dvě stávky ve stejné čtvrti nepotlačí hasiče na
* čtvrtinu — platí ta horší. Skládání by z několika souběžných katastrof
* udělalo násobek, ze kterého se město nevzpamatuje.
*/
function strongestModifier(world, kind, cell, fallback, serviceClass, pick = Math.min) {
	let value = fallback;
	let found = false;
	for (const modifier of world.disasters.modifiers) {
		if (modifier.kind !== kind) continue;
		if (serviceClass !== void 0 && modifier.serviceClass !== serviceClass) continue;
		if (modifier.cells.length > 0 && !modifier.cells.includes(cell)) continue;
		value = found ? pick(value, modifier.amount) : modifier.amount;
		found = true;
	}
	return value;
}
/** Buňka hrubé mřížky pro dlaždici. Vystaveno kvůli katastrofám, které si ji počítají samy. */
function cellOfTile(world, tile) {
	const x = tile % world.size;
	return coarseIndex(x, (tile - x) / world.size, world.size);
}
//#endregion
//#region src/sim/systems/water.ts
/**
* Vodovod (§8 zadání fáze 3).
*
* Vypadá to jako elektřina, ale liší se ve třech věcech, a každá z nich je
* záměr:
*
* 1. **Budovy vodu nevedou.** Elektřina teče přes silnice i budovy, voda jen
*    potrubím. Kdo chce mít pod domem vodu, musí tam potrubí položit. Proto je
*    to jiná mechanika, ne kopie s jiným jménem.
* 2. **Síť má dosah.** Voda dojde jen `range` dlaždic od zdroje. Čerpací
*    stanice je zdroj **bez vlastní výroby**: sama musí být na vodě a rozjíždí
*    z místa, kde stojí, nový dosah. Tím se síť prodlužuje po skocích, místo
*    aby jedna vodárna zásobila celou mapu.
* 3. **Výsledek je runtime, ne vrstva.** `waterSupply` se po načtení savu
*    spočítá znovu ze zdrojů a potrubí, takže se nemůže rozejít se skutečností.
*
* Běží každý tik, ale flood fill pouští jen při `waterNetworkDirty` — stejná
* úspora jako u elektřiny.
*/
var INTERVAL$5 = 1;
/** Offset 1, aby voda a elektřina nepočítaly flood fill ve stejném tiku. */
var OFFSET$5 = 1;
function createWaterSystem(catalogue, balance) {
	return {
		name: "water",
		interval: INTERVAL$5,
		offset: OFFSET$5,
		run(world) {
			if (!world.waterNetworkDirty) return;
			world.waterNetworkDirty = false;
			recompute(world, catalogue, balance);
		}
	};
}
function recompute(world, catalogue, balance) {
	const supply = world.waterSupply;
	const before = Uint8Array.from(supply);
	supply.fill(0);
	const ids = [...world.buildings.keys()].sort((a, b) => a - b);
	const sources = [];
	let production = 0;
	for (const id of ids) {
		const building = world.buildings.get(id);
		if (!building || building.abandoned) continue;
		const definition = catalogue.get(building.definitionId);
		const water = definition?.water;
		if (!definition || !water) continue;
		const produced = water.production ?? 0;
		const range = water.range ?? balance.water.defaultRange;
		if (produced <= 0 && range <= 0) continue;
		if (produced > 0 && isContaminated(world, building.x, building.y)) continue;
		production += produced;
		sources.push({
			tiles: footprintTiles(world.size, building.x, building.y, definition.footprint),
			range,
			produces: produced > 0
		});
	}
	if (production > 0) floodFill(world, sources, supply);
	markChangedTiles(world, before, supply);
	markWateredBuildings(world, catalogue, ids);
}
/** Je vodárna v zamořené buňce? */
function isContaminated(world, x, y) {
	if (world.disasters.modifiers.length === 0) return false;
	return strongestModifier(world, "contaminateWater", coarseIndex(x, y, world.size), 0, void 0, Math.max) > 0;
}
/** Označí dlaždice, kterým voda přibyla nebo zmizela. */
function markChangedTiles(world, before, after) {
	for (let tile = 0; tile < after.length; tile++) {
		if (before[tile] === after[tile]) continue;
		const x = tile % world.size;
		markTileDirty(world, x, (tile - x) / world.size);
	}
}
function footprintTiles(size, x, y, footprint) {
	const tiles = [];
	for (let dy = 0; dy < footprint[1]; dy++) for (let dx = 0; dx < footprint[0]; dx++) {
		const tx = x + dx;
		const ty = y + dy;
		if (tx >= 0 && ty >= 0 && tx < size && ty < size) tiles.push(index(tx, ty, size));
	}
	return tiles;
}
/**
* Průchod potrubím do šířky, kde se počítá **zbývající dosah**.
*
* Dlaždice se smí navštívit znovu, když k ní přiteče voda s větší rezervou —
* jinak by pořadí zdrojů rozhodovalo o tom, kam síť dosáhne, a výsledek by
* závisel na tom, co hráč postavil dřív.
*/
function floodFill(world, sources, supply) {
	const { pipe } = world.layers;
	const size = world.size;
	const remaining = new Int32Array(pipe.length).fill(-1);
	let frontier = [];
	for (const source of sources) {
		if (!source.produces) continue;
		for (const tile of source.tiles) if (source.range > remaining[tile]) {
			remaining[tile] = source.range;
			frontier.push(tile);
		}
	}
	const relays = sources.filter((source) => !source.produces);
	const used = /* @__PURE__ */ new Set();
	while (frontier.length > 0) {
		const next = [];
		for (const tile of frontier) {
			const budget = remaining[tile] ?? 0;
			if (budget <= 0) continue;
			const x = tile % size;
			const y = (tile - x) / size;
			for (const [dx, dy] of [
				[0, -1],
				[1, 0],
				[0, 1],
				[-1, 0]
			]) {
				const nx = x + dx;
				const ny = y + dy;
				if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
				const at = index(nx, ny, size);
				if (pipe[at] !== 1) continue;
				if (isFlooded(world, at)) continue;
				if (budget - 1 <= (remaining[at] ?? -1)) continue;
				remaining[at] = budget - 1;
				next.push(at);
			}
		}
		if (next.length === 0) for (const relay of relays) {
			if (used.has(relay)) continue;
			if (!relay.tiles.some((tile) => (remaining[tile] ?? -1) >= 0)) continue;
			used.add(relay);
			for (const tile of relay.tiles) if (relay.range > (remaining[tile] ?? -1)) {
				remaining[tile] = relay.range;
				next.push(tile);
			}
		}
		frontier = next;
	}
	for (let tile = 0; tile < supply.length; tile++) if ((remaining[tile] ?? -1) >= 0) supply[tile] = 1;
}
/**
* Chátrání bez vody (§8 fáze 3).
*
* Běží řidčeji než rozvod — je to pomalý tlak, ne trest za jeden tik. Budova,
* které voda chybí, ztrácí obyvatele; když je prázdná dost dlouho, zůstane po
* ní ruina. **Jen budovy, které vodu podle definice potřebují**: elektrárna se
* bez vodovodu obejde.
*/
var DECAY_INTERVAL = 16;
var DECAY_OFFSET = 7;
function createWaterDecaySystem(catalogue, balance) {
	return {
		name: "waterDecay",
		interval: DECAY_INTERVAL,
		offset: DECAY_OFFSET,
		run(world) {
			const { decayStep, abandonAfter } = balance.water;
			for (const id of [...world.buildings.keys()].sort((a, b) => a - b)) {
				const building = world.buildings.get(id);
				if (!building || building.abandoned) continue;
				if (catalogue.get(building.definitionId)?.construction.requiresWater !== true) continue;
				if (world.watered.has(id)) {
					world.waterlessStreak.delete(id);
					continue;
				}
				const streak = (world.waterlessStreak.get(id) ?? 0) + 1;
				world.waterlessStreak.set(id, streak);
				if (building.population > 0) {
					building.population = Math.max(0, building.population - decayStep);
					markBuildingDirty(world, id);
				} else if (streak >= abandonAfter) {
					building.abandoned = true;
					building.jobs = 0;
					world.waterlessStreak.delete(id);
					markBuildingDirty(world, id);
				}
			}
		}
	};
}
/**
* Budova má vodu, když ji má **kterákoli dlaždice jejího půdorysu**.
*
* Zapisuje se do `world.watered`, ne do entity: je to odvozený stav, který se
* po načtení savu spočítá znovu (R10 platí i tady).
*/
function markWateredBuildings(world, catalogue, ids) {
	for (const id of ids) {
		const building = world.buildings.get(id);
		if (!building) continue;
		const footprint = catalogue.get(building.definitionId)?.footprint ?? [1, 1];
		const watered = footprintTiles(world.size, building.x, building.y, footprint).some((tile) => world.waterSupply[tile] === 1);
		if (watered === world.watered.has(id)) continue;
		if (watered) world.watered.add(id);
		else world.watered.delete(id);
		markBuildingDirty(world, id);
	}
}
//#endregion
//#region src/sim/terrain.ts
/**
* Terén jako hratelný údaj (§2 zadání fáze 3).
*
* Cena půdy i znečištění žijí na hrubé mřížce, terén na plné. Tenhle soubor
* ten rozdíl překlenuje: spočítá, jaký **podíl** buňky zabírá který terén.
*
* Počítá se jednou za běh systému a předává dál. Kdyby si to každá buňka
* počítala sama, byl by z toho průchod 16 384 dlaždicemi pro každou z 1024
* buněk.
*/
function coarseTerrainShare(world, terrain) {
	const cached = world.terrainShares.get(terrain);
	if (cached) return cached;
	const size = world.size;
	const coarseSize = coarseSizeOf(size);
	const share = new Float32Array(coarseCellsOf(size));
	const perCell = 16;
	for (let y = 0; y < size; y++) {
		const cellY = y / 4 | 0;
		for (let x = 0; x < size; x++) {
			if (world.layers.terrain[index(x, y, size)] !== terrain) continue;
			const cell = cellY * coarseSize + (x / 4 | 0);
			share[cell] = (share[cell] ?? 0) + 1 / perCell;
		}
	}
	world.terrainShares.set(terrain, share);
	return share;
}
/** Terény, na které se nedá stavět, dokud je hráč neupraví (§2). */
function needsClearing(terrain) {
	return terrain === TERRAIN.forest || terrain === TERRAIN.marsh || terrain === TERRAIN.rock;
}
//#endregion
//#region src/sim/rci.ts
/**
* Tři zónové kategorie, na kterých stojí poptávka i daně.
*
* Kategorie je zároveň hodnota v definicích obsahu (`category` v JSONu), takže
* tohle je jediné místo, kde se mřížková zóna potkává s taxonomií obsahu.
* Konkrétní budovy tady nejsou (P5).
*/
var RCI_CATEGORIES = [
	"residential",
	"commercial",
	"industrial"
];
function categoryForZone(zone) {
	if (zone === ZONE.residential) return "residential";
	if (zone === ZONE.commercial) return "commercial";
	if (zone === ZONE.industrial) return "industrial";
	return null;
}
function isRciCategory(category) {
	return RCI_CATEGORIES.includes(category);
}
//#endregion
//#region src/sim/result.ts
var OK = { ok: true };
function reject(reason, params) {
	return params ? {
		ok: false,
		reason,
		params
	} : {
		ok: false,
		reason
	};
}
//#endregion
//#region src/sim/buildings.ts
/**
* Vejde se budova na tohle místo? Vrací **konkrétní důvod**, ne jen ano/ne —
* hráč musí vědět, proč mu klik nic neudělal.
*/
function checkFootprint(world, definition, x, y, options = {}) {
	const [width, depth] = definition.footprint;
	for (let dy = 0; dy < depth; dy++) for (let dx = 0; dx < width; dx++) {
		const tileX = x + dx;
		const tileY = y + dy;
		if (!inBounds(tileX, tileY, world.size)) return reject("error.outOfBounds");
		const tile = index(tileX, tileY, world.size);
		if (options.requireZone !== void 0 && world.layers.zone[tile] !== options.requireZone) return reject("error.wrongZone");
		if (world.layers.road[tile] !== 0) return reject("error.roadInTheWay");
		if ((world.rubble[tile] ?? 0) !== 0) return reject("error.rubbleInTheWay");
		if (world.layers.buildingId[tile] !== 0) return reject("error.occupiedFootprint", {
			width,
			depth
		});
		const terrain = world.layers.terrain[tile] ?? 0;
		if (!definition.construction.allowedTerrain.includes(terrain)) return reject("error.terrainNotAllowed");
		if (!options.skipFlatCheck && !definition.construction.allowsSlope && !isFlatTile(world.cornerHeight, tileX, tileY)) return reject("error.notFlat");
	}
	if (definition.construction.requiresRoad && !options.skipRoadCheck && !touchesRoad$1(world, definition, x, y)) return reject("error.needsRoad");
	if (definition.construction.requiresPower && !touchesPower(world, definition, x, y)) return reject("error.needsPower");
	if (definition.construction.requiresWater === true && !hasWater(world, definition, x, y)) return reject("error.needsWater");
	if (definition.construction.nearWater === true && !touchesWater$1(world, definition, x, y)) return reject("error.needsShore");
	return OK;
}
/** Je pod půdorysem voda z vodovodu? Potrubí musí být položené, ne jen vedle. */
function hasWater(world, definition, x, y) {
	const [width, depth] = definition.footprint;
	for (let dy = 0; dy < depth; dy++) for (let dx = 0; dx < width; dx++) {
		if (!inBounds(x + dx, y + dy, world.size)) continue;
		if (world.waterSupply[index(x + dx, y + dy, world.size)] === 1) return true;
	}
	return false;
}
/** Sousedí footprint s vodní plochou? Vodárna z ní bere (§8 fáze 3). */
function touchesWater$1(world, definition, x, y) {
	const [width, depth] = definition.footprint;
	for (let dy = -1; dy <= depth; dy++) for (let dx = -1; dx <= width; dx++) {
		if (!(dx === -1 || dy === -1 || dx === width || dy === depth)) continue;
		const tx = x + dx;
		const ty = y + dy;
		if (!inBounds(tx, ty, world.size)) continue;
		if (world.layers.terrain[index(tx, ty, world.size)] === TERRAIN.water) return true;
	}
	return false;
}
/** Sousedí footprint aspoň jednou stranou se silnicí? */
function touchesRoad$1(world, definition, x, y) {
	return touchesLayerValue(world.layers.road, definition, x, y);
}
/**
* Sousedí footprint s dlaždicí, kam vede proud? Vlastní dlaždice se nepočítají —
* budova ještě nestojí, takže vodičem není.
*/
function touchesPower(world, definition, x, y) {
	return touchesLayerValue(world.layers.power, definition, x, y);
}
function touchesLayerValue(layer, definition, x, y) {
	const [width, depth] = definition.footprint;
	for (let dy = 0; dy < depth; dy++) for (let dx = 0; dx < width; dx++) {
		const tileX = x + dx;
		const tileY = y + dy;
		if (isSet(layer, tileX, tileY - 1) || isSet(layer, tileX + 1, tileY) || isSet(layer, tileX, tileY + 1) || isSet(layer, tileX - 1, tileY)) return true;
	}
	return false;
}
/**
* Je na dlaždici hodnota, která znamená „ano"?
*
* **Nenulová, ne jednička.** Vrstva `power` je 0/1, ale `road` od T24 nese typ:
* 1 ulice, 2 třída, 3 dálnice. Porovnání s jedničkou znamenalo, že budovy
* uznávaly jen ulici a u třídy ani dálnice nešlo stavět — nahlásil autor při
* hraní.
*/
function isSet(layer, x, y) {
	const size = sizeOfLayer(layer);
	return inBounds(x, y, size) && (layer[index(x, y, size)] ?? 0) !== 0;
}
function placeBuilding(world, definition, x, y) {
	const building = {
		id: world.nextBuildingId++,
		definitionId: definition.id,
		x,
		y,
		level: definition.level,
		population: definition.population?.capacity ?? 0,
		jobs: definition.jobs?.capacity ?? 0,
		powered: false,
		builtAtTick: world.tick,
		levelChangedAtTick: world.tick,
		abandoned: false
	};
	world.buildings.set(building.id, building);
	const [width, depth] = definition.footprint;
	for (let dy = 0; dy < depth; dy++) for (let dx = 0; dx < width; dx++) {
		world.layers.buildingId[index(x + dx, y + dy, world.size)] = building.id;
		markTileDirty(world, x + dx, y + dy);
	}
	markBuildingDirty(world, building.id);
	markPowerNetworkDirty(world);
	markWaterNetworkDirty(world);
	if (definition.service) markCoverageDirty(world);
	return building;
}
//#endregion
//#region src/sim/requirements.ts
/**
* Prerekvizity budov (§7 zadání fáze 2).
*
* Dvě podmínky: minimální **pokrytí službou** v buňce, kde budova stojí, a
* **existence jiné budovy** ve městě. Vanilla obsah 2a je nechává prázdné, ale
* mechanismus vyhodnocují růst, povyšování i ruční stavba — až se hodnoty
* doplní, je to změna JSONu, ne kódu (P5).
*
* Vrací se `CommandResult`, ne `boolean`: hráč, kterému klik nic neudělá, musí
* vědět proč.
*/
/**
* Definice, které ve městě opravdu stojí.
*
* Ruina se nepočítá — prázdná budova nic neposkytuje, takže jako podmínka
* platit nemůže.
*/
function presentDefinitions(world) {
	const present = /* @__PURE__ */ new Set();
	for (const building of world.buildings.values()) if (!building.abandoned) present.add(building.definitionId);
	return present;
}
/**
* Splňuje místo `x, y` podmínky definice?
*
* `present` si volající předpočítá přes `presentDefinitions` — růst i povyšování
* se ptají mnohokrát za běh a procházet kvůli tomu pokaždé všechny budovy by
* bylo zbytečné.
*/
function checkRequirements(world, catalogue, definition, x, y, present) {
	const requirements = definition.requirements;
	if (!requirements) return OK;
	const cell = coarseIndex(x, y, world.size);
	for (const serviceClass of Object.keys(requirements.services).sort()) {
		const needed = requirements.services[serviceClass] ?? 0;
		if ((coverageOf(world, serviceClass)?.[cell] ?? 0) < needed) return reject("error.requiresService", {
			service: `ui.service.${serviceClass}`,
			needed
		});
	}
	for (const required of requirements.buildings) if (!present.has(required)) return reject("error.requiresBuilding", { id: catalogue.get(required)?.name ?? required });
	return OK;
}
//#endregion
//#region src/sim/levels.ts
/**
* Úrovně budov a slučování (§8 zadání fáze 2).
*
* Úroveň i půdorys jsou vlastnost **definice**, ne entity — entita nese jen
* `level` a `definitionId`. Povýšení je proto vždycky výměna definice pod
* stejnou entitou, ne úprava jejích čísel.
*
* Katalog nemusí mít všechny kombinace (kategorie, půdorys, úroveň). Chybějící
* kombinace znamená, že daná cesta růstu není dostupná — ne chybu (R5).
*/
/**
* Pořadí směrů je pevné kvůli P2: kdyby se procházely v pořadí podle nějakého
* `Map`, výsledek by závisel na historii vkládání a determinismus by padl.
* Kde je opravdu potřeba rozhodnout mezi rovnocennými možnostmi, rozhoduje
* `world.rng`.
*/
var DIRECTIONS = [
	[1, 0],
	[0, 1],
	[-1, 0],
	[0, -1]
];
/** Definice dané kategorie s přesně tímhle půdorysem a úrovní. */
function definitionsFor(catalogue, category, width, depth, level) {
	return catalogue.byCategory(category).filter((definition) => definition.level === level && definition.footprint[0] === width && definition.footprint[1] === depth);
}
/** Jedna z definic pro trojici (kategorie, půdorys, úroveň); vybírá `world.rng`. */
function pickDefinition(world, catalogue, category, width, depth, level) {
	const options = definitionsFor(catalogue, category, width, depth, level);
	if (options.length === 0) return void 0;
	return options[world.rng.int(options.length)];
}
/**
* Definice, kterými zástavba **začíná**: úroveň 1 a nejmenší půdorys v kategorii.
*
* Bez tohohle filtru by růst losoval z celého žebříčku a na prázdné parcele by
* rovnou vyrostl věžák. Že je začátek ten nejmenší, plyne z obsahu — kód žádnou
* velikost nezná (P5).
*/
function seedDefinitions(catalogue, category) {
	const level1 = catalogue.byCategory(category).filter((definition) => definition.level === 1);
	if (level1.length === 0) return [];
	const smallest = level1.reduce((min, definition) => Math.min(min, area(definition)), Number.MAX_SAFE_INTEGER);
	return level1.filter((definition) => area(definition) === smallest);
}
function area(definition) {
	return definition.footprint[0] * definition.footprint[1];
}
/**
* Zkusí budovu povýšit. Vrací `true`, když se něco stalo.
*
* **Šířka má přednost před výškou** (zadání autora): dřív než budova vyroste
* o patro, zkusí pohltit sousední parcelu. Volající si musí sám ohlídat prahy
* ceny půdy, poptávku a cooldown — tahle funkce řeší jen „co je vůbec možné".
*/
function tryUpgrade(world, catalogue, building, present = presentDefinitions(world)) {
	const definition = catalogue.get(building.definitionId);
	if (!definition || building.abandoned) return false;
	const upgrade = planWiden(world, catalogue, definition, building, present) ?? planTaller(world, catalogue, definition, building, present);
	if (!upgrade) return false;
	apply(world, definition, building, upgrade);
	return true;
}
/** Rozšíření do jednoho ze čtyř směrů. Pořadí směrů je pevné. */
function planWiden(world, catalogue, definition, building, present) {
	const [width, depth] = definition.footprint;
	const zone = world.layers.zone[index(building.x, building.y, world.size)] ?? 0;
	for (const [dx, dy] of DIRECTIONS) {
		const newWidth = width + Math.abs(dx);
		const newDepth = depth + Math.abs(dy);
		const x = dx < 0 ? building.x - 1 : building.x;
		const y = dy < 0 ? building.y - 1 : building.y;
		const candidate = pickDefinition(world, catalogue, definition.category, newWidth, newDepth, building.level);
		if (!candidate) continue;
		if (!checkRequirements(world, catalogue, candidate, x, y, present).ok) continue;
		const absorbed = claimable(world, catalogue, candidate, building, zone, x, y);
		if (absorbed) return {
			definition: candidate,
			x,
			y,
			absorbed
		};
	}
	return null;
}
/**
* Smí budova zabrat celý obdélník `x, y` o velikosti kandidáta?
*
* Vrací seznam budov, které se tím pohltí, nebo `null`, když to nejde. Prázdné
* pole je platná odpověď — znamená „vejde se to na volné parcely".
*/
function claimable(world, catalogue, candidate, building, zone, x, y) {
	const [width, depth] = candidate.footprint;
	const absorbed = /* @__PURE__ */ new Set();
	for (let ty = y; ty < y + depth; ty++) for (let tx = x; tx < x + width; tx++) {
		if (!inBounds(tx, ty, world.size)) return null;
		const tile = index(tx, ty, world.size);
		if (world.layers.zone[tile] !== zone) return null;
		if (world.layers.road[tile] !== 0) return null;
		const terrain = world.layers.terrain[tile] ?? 0;
		if (!candidate.construction.allowedTerrain.includes(terrain)) return null;
		const occupant = world.layers.buildingId[tile] ?? 0;
		if (occupant === 0 || occupant === building.id) continue;
		const neighbour = world.buildings.get(occupant);
		const neighbourDefinition = neighbour && catalogue.get(neighbour.definitionId);
		if (!neighbour || !neighbourDefinition) return null;
		if (neighbour.abandoned) return null;
		if (neighbourDefinition.category !== candidate.category) return null;
		if (neighbour.level >= building.level) return null;
		absorbed.add(occupant);
	}
	return [...absorbed].sort((a, b) => a - b);
}
/** Vyrostení o patro na stejném půdorysu. */
function planTaller(world, catalogue, definition, building, present) {
	const [width, depth] = definition.footprint;
	const taller = pickDefinition(world, catalogue, definition.category, width, depth, building.level + 1);
	if (!taller) return null;
	if (!checkRequirements(world, catalogue, taller, building.x, building.y, present).ok) return null;
	return {
		definition: taller,
		x: building.x,
		y: building.y,
		absorbed: []
	};
}
/**
* Sníží budovu o úroveň. Vrací `true`, když se něco stalo.
*
* Hledá definici pro `L − 1` se **stejným půdorysem**; když neexistuje, spokojí
* se s menším a uvolněné dlaždice vrátí jako prázdné zónované parcely. Pod
* úrovní 1 nastává opuštění (§8).
*/
function tryDowngrade(world, catalogue, building) {
	const definition = catalogue.get(building.definitionId);
	if (!definition || building.abandoned) return false;
	const lower = building.level - 1;
	if (lower < 1) {
		abandon(world, building);
		return true;
	}
	const [width, depth] = definition.footprint;
	const smaller = pickShrunk(world, catalogue, definition.category, width, depth, lower);
	if (!smaller) return false;
	apply(world, definition, building, {
		definition: smaller,
		x: building.x,
		y: building.y,
		absorbed: []
	});
	return true;
}
/**
* Největší definice úrovně `level`, která se vejde do stávajícího půdorysu.
*
* Stejný půdorys má přednost — teprve když pro nižší úroveň neexistuje, budova
* se scvrkne a zbytek parcely se uvolní.
*/
function pickShrunk(world, catalogue, category, width, depth, level) {
	const fitting = catalogue.byCategory(category).filter((candidate) => candidate.level === level && candidate.footprint[0] <= width && candidate.footprint[1] <= depth);
	if (fitting.length === 0) return void 0;
	const largest = fitting.reduce((max, candidate) => Math.max(max, area(candidate)), 0);
	const options = fitting.filter((candidate) => area(candidate) === largest);
	return options[world.rng.int(options.length)];
}
/**
* Opuštění. Budova zůstane stát i s půdorysem, ale přestane městu sloužit.
*
* Definice se nemění: ruina je pořád ten dům, jen prázdný. Renderer si ji
* podle příznaku vykreslí jinak, ekonomika ji přeskočí a kriminalita ji
* započítá.
*/
function abandon(world, building) {
	building.abandoned = true;
	building.population = 0;
	building.jobs = 0;
	building.levelChangedAtTick = world.tick;
	markBuildingDirty(world, building.id);
	markPowerNetworkDirty(world);
}
/**
* Přepíše entitu na novou definici.
*
* Entita si drží `id` i `builtAtTick` — pro město je to pořád ten samý dům,
* jen povýšený. Populace a pracovní místa se nesčítají, určuje je nová
* definice (§8).
*/
function apply(world, previous, building, upgrade) {
	clearFootprint(world, previous, building.x, building.y);
	for (const id of upgrade.absorbed) removeBuilding(world, id);
	const { definition } = upgrade;
	building.definitionId = definition.id;
	building.x = upgrade.x;
	building.y = upgrade.y;
	building.level = definition.level;
	building.population = definition.population?.capacity ?? 0;
	building.jobs = definition.jobs?.capacity ?? 0;
	building.levelChangedAtTick = world.tick;
	const [width, depth] = definition.footprint;
	for (let dy = 0; dy < depth; dy++) for (let dx = 0; dx < width; dx++) {
		world.layers.buildingId[index(upgrade.x + dx, upgrade.y + dy, world.size)] = building.id;
		markTileDirty(world, upgrade.x + dx, upgrade.y + dy);
	}
	markBuildingDirty(world, building.id);
	markPowerNetworkDirty(world);
	if (previous.service || definition.service) markCoverageDirty(world);
}
function clearFootprint(world, definition, x, y) {
	const [width, depth] = definition.footprint;
	for (let dy = 0; dy < depth; dy++) for (let dx = 0; dx < width; dx++) {
		world.layers.buildingId[index(x + dx, y + dy, world.size)] = 0;
		markTileDirty(world, x + dx, y + dy);
	}
}
//#endregion
//#region src/sim/systems/growth.ts
function createGrowthSystem(catalogue, balance) {
	return {
		name: "growth",
		interval: 12,
		offset: 2,
		run(world) {
			grow(world, catalogue, balance);
		}
	};
}
function grow(world, catalogue, balance) {
	if (world.economy.funds < 0) return;
	const reach = roadReach(world, balance.growth.roadFactors.length - 1);
	const access = jobAccessByCell(world, catalogue, balance.growth.minAccessFactor);
	const cityAccess = cityAccessFactor(world, catalogue, balance.growth.minAccessFactor);
	world.jobAccessCells = access;
	world.cityJobAccess = cityAccess;
	const present = presentDefinitions(world);
	for (const category of RCI_CATEGORIES) {
		const attempts = attemptsFor(world, balance, category, cityAccess);
		if (attempts === 0) continue;
		const candidates = collectCandidates(world, balance, category, reach, access);
		let total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
		for (let attempt = 0; attempt < attempts && total > 0; attempt++) {
			const picked = pick(candidates, world.rng.next() * total);
			if (!picked) break;
			total -= picked.weight;
			picked.weight = 0;
			tryBuild(world, catalogue, category, picked.tile, present);
		}
	}
}
/**
* Kolik pokusů poptávka zaplatí.
*
* `faktorDaně` je tady, a ne ve skóre parcely: uvnitř kategorie je pro všechny
* parcely stejný, takže by se ve váženém losu vykrátil a daň by na růst neměla
* vliv. Zadání §9 přitom chce pravý opak — je to první skutečná vazba daní na
* růst. **Doplněk zadání**, které vzorec dělí mezi skóre a počet pokusů.
*/
function attemptsFor(world, balance, category, cityAccess) {
	const demand = world.demand[category];
	if (demand <= 0) return 0;
	const { demandPerAttempt, maxAttempts, neutralTaxRate, taxRange } = balance.growth;
	const rate = world.economy.taxRates[category];
	const taxFactor = Math.max(.2, Math.min(1.5, 1 - (rate - neutralTaxRate) / taxRange));
	const raw = demand / demandPerAttempt * taxFactor * cityAccess;
	const whole = Math.floor(raw);
	const attempts = whole + (world.rng.next() < raw - whole ? 1 : 0);
	return Math.max(0, Math.min(maxAttempts, attempts));
}
/**
* Volné zónované parcely dané kategorie i s váhou.
*
* K ceně půdy se přičítá jednička, aby čerstvá mapa vůbec začala růst — cena
* půdy se do svého základu teprve rozjíždí a nulová váha by znamenala, že se
* první měsíce nepostaví nic.
*/
function collectCandidates(world, balance, category, reach, access) {
	const { zone, buildingId, road } = world.layers;
	const candidates = [];
	for (const tile of world.zonedTiles) {
		if (buildingId[tile] !== 0 || road[tile] !== 0) continue;
		if (categoryForZone(zone[tile] ?? ZONE.none) !== category) continue;
		const distance = reach[tile] ?? 255;
		const roadFactor = balance.growth.roadFactors[distance] ?? 0;
		if (roadFactor === 0) continue;
		const x = tile % world.size;
		const y = (tile - x) / world.size;
		const cell = coarseIndex(x, y, world.size);
		const landValue = world.coarse.landValue[cell] ?? 0;
		const slopeFactor = isFlatTile(world.cornerHeight, x, y) ? 1 : balance.growth.slopeFactor;
		const weight = Math.pow(landValue + 1, balance.growth.exponent) * roadFactor * slopeFactor * (access[cell] ?? 1);
		if (weight > 0) candidates.push({
			tile,
			weight
		});
	}
	return candidates;
}
/** Vážený los: vrátí parcelu, do jejíhož intervalu spadne `roll`. */
function pick(candidates, roll) {
	let seen = 0;
	let last;
	for (const candidate of candidates) {
		if (candidate.weight === 0) continue;
		seen += candidate.weight;
		if (roll < seen) return candidate;
		last = candidate;
	}
	return last;
}
/**
* Vzdálenost každé dlaždice k nejbližší silnici, ořezaná na dosah růstu.
*
* Průchod do šířky ze všech silnic naráz: jeden průchod mapou místo prohledávání
* okolí u každé z tisíců parcel.
*/
function roadReach(world, maxDistance) {
	const { road } = world.layers;
	const distance = new Uint8Array(road.length).fill(255);
	const frontierStart = [];
	for (const tile of world.roadTiles) {
		distance[tile] = 0;
		frontierStart.push(tile);
	}
	let frontier = frontierStart;
	for (let step = 1; step <= maxDistance && frontier.length > 0; step++) {
		const next = [];
		for (const tile of frontier) {
			const x = tile % world.size;
			const y = (tile - x) / world.size;
			for (const [dx, dy] of NEIGHBOURS$3) {
				const nx = x + dx;
				const ny = y + dy;
				if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
				const at = index(nx, ny, world.size);
				if (distance[at] !== 255) continue;
				distance[at] = step;
				next.push(at);
			}
		}
		frontier = next;
	}
	return distance;
}
var NEIGHBOURS$3 = [
	[0, -1],
	[1, 0],
	[0, 1],
	[-1, 0]
];
function tryBuild(world, catalogue, category, tile, present) {
	const x = tile % world.size;
	const y = (tile - x) / world.size;
	const zone = world.layers.zone[tile] ?? ZONE.none;
	const options = seedDefinitions(catalogue, category);
	if (options.length === 0) return;
	const definition = options[world.rng.int(options.length)];
	if (!definition) return;
	if (!checkFootprint(world, definition, x, y, {
		requireZone: zone,
		skipRoadCheck: true,
		skipFlatCheck: true
	}).ok) return;
	if (!checkRequirements(world, catalogue, definition, x, y, present).ok) return;
	placeBuilding(world, definition, x, y);
}
/**
* Násobitel skóre podle dosažitelnosti práce, po buňkách hrubé mřížky (R6).
*
* **Moduluje, nevetuje.** Tvrdá brána by hru zamkla: na začátku nejsou žádná
* pracovní místa, takže by dosažitelnost byla všude nulová, nic by nevyrostlo
* a místa by nikdy nevznikla. Špatně obsloužená čtvrť proto roste pomalu, ne
* vůbec.
*
* Prázdná čtvrť dostane jedničku — nová zástavba se netrestá za to, že v ní
* zatím nikdo nebydlí. A dokud ve městě není ani jedno pracovní místo, platí
* jednička všude; jinak by první dům neměl kam chodit a hra by se nerozjela.
*/
function jobAccessByCell(world, catalogue, minFactor) {
	const cells = coarseCellsOf(world.size);
	const factors = new Float32Array(cells).fill(1);
	let totalJobs = 0;
	for (const building of world.buildings.values()) if (!building.abandoned) totalJobs += building.jobs;
	if (totalJobs === 0) return factors;
	const sums = new Float32Array(cells);
	const counts = new Float32Array(cells);
	for (const building of world.buildings.values()) {
		if (building.abandoned || building.population === 0) continue;
		if (catalogue.get(building.definitionId)?.category !== "residential") continue;
		const cell = coarseIndex(building.x, building.y, world.size);
		sums[cell] = (sums[cell] ?? 0) + (world.jobAccess.get(building.id) ?? 0);
		counts[cell] = (counts[cell] ?? 0) + 1;
	}
	const min = minFactor;
	for (let cell = 0; cell < factors.length; cell++) {
		const count = counts[cell] ?? 0;
		if (count === 0) continue;
		const average = (sums[cell] ?? 0) / count;
		factors[cell] = min + (1 - min) * Math.max(0, Math.min(1, average));
	}
	return factors;
}
/**
* Jak dobře se ve městě jako celku dostane do práce, převedené na násobitel
* rychlosti růstu (R6).
*
* **Moduluje, nevetuje** — nejnižší hodnota je `minAccessFactor`, ne nula.
* A dokud ve městě není ani jedno pracovní místo, je to jednička: jinak by se
* hra zamkla hned na začátku, kdy dosažitelnost nutně nula je.
*/
function cityAccessFactor(world, catalogue, minFactor) {
	let jobs = 0;
	let sum = 0;
	let homes = 0;
	for (const building of world.buildings.values()) {
		if (building.abandoned) continue;
		jobs += building.jobs;
		if (building.population === 0) continue;
		if (catalogue.get(building.definitionId)?.category !== "residential") continue;
		sum += world.jobAccess.get(building.id) ?? 0;
		homes++;
	}
	if (jobs === 0 || homes === 0) return 1;
	const average = Math.max(0, Math.min(1, sum / homes));
	return minFactor + (1 - minFactor) * average;
}
//#endregion
//#region src/sim/systems/landValue.ts
/**
* Cena půdy (§4 zadání fáze 2). Běží každých 16 tiků, offset 5.
*
* ```
* surová = ZÁKLAD + bonusVody − znečištění × VÁHA
* cena   = lerp(cena, surová, VYHLAZENÍ)
* ```
*
* Váhy tříd služeb pokrývají celou sadu ze zadání; službu, která ve městě
* není, prostě není z čeho počítat.
*
* **Zástavba do vzorce nevstupuje** (rozhodnutí R2 v zadání). Kdyby vstupovala,
* vznikla by utržená smyčka: vyšší úroveň → hustší zástavba → vyšší cena půdy
* → vyšší úroveň.
*
* Vyhlazení existuje proto, aby cena půdy nereagovala skokem — jinak by hráč
* postavil park a celá čtvrť by okamžitě přeskočila o dvě úrovně.
*
* Všechny konstanty i váhy jdou z `balance.json` (§10). Váhy tříd služeb jsou
* otevřený seznam, protože třídy jsou obsah — mod si přidá vlastní.
*/
function createLandValueSystem(balance) {
	return {
		name: "landValue",
		interval: 16,
		offset: 5,
		run(world) {
			const context = landValueContext(world, balance);
			const { landValue } = world.coarse;
			const { smoothing } = balance.landValue;
			for (let cell = 0; cell < landValue.length; cell++) {
				const raw = landValueRaw(world, balance, cell, context, null) - strongestModifier(world, "landValuePenalty", cell, 0, void 0, Math.max);
				const current = landValue[cell] ?? 0;
				const delta = raw - current;
				const next = current + delta * smoothing;
				landValue[cell] = Math.max(0, Math.min(255, delta > 0 ? Math.ceil(next) : Math.floor(next)));
			}
			world.dirty.coarseChanged = true;
		}
	};
}
/**
* Buňky, které obsahují vodu nebo s takovou sousedí.
*
* Počítá se při každém běhu z terénu, ne jednou při vzniku mapy: je to 1024
* buněk jednou za 16 tiků a odpadá tím stav, který by se mohl rozejít s mapou.
*
* Je to jediný vstup ceny půdy, který nezávisí na hráči — mapa díky němu není
* homogenní ještě než se cokoli postaví.
*/
function waterProximity(world) {
	const cached = world.waterNear;
	if (cached) return cached;
	const size = world.size;
	const coarse = coarseSizeOf(size);
	const hasWater = new Uint8Array(coarse * coarse);
	for (let cellY = 0; cellY < coarse; cellY++) for (let cellX = 0; cellX < coarse; cellX++) {
		let found = false;
		for (let dy = 0; dy < 4 && !found; dy++) for (let dx = 0; dx < 4; dx++) {
			const tileX = cellX * 4 + dx;
			const tileY = cellY * 4 + dy;
			if (tileX >= size || tileY >= size) continue;
			if (world.layers.terrain[index(tileX, tileY, size)] === TERRAIN.water) {
				found = true;
				break;
			}
		}
		if (found) hasWater[cellY * coarse + cellX] = 1;
	}
	const nearWater = new Uint8Array(coarse * coarse);
	for (let cellY = 0; cellY < coarse; cellY++) for (let cellX = 0; cellX < coarse; cellX++) {
		let near = false;
		for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
			if (!coarseInBounds(cellX + dx, cellY + dy, coarse)) continue;
			if (hasWater[(cellY + dy) * coarse + (cellX + dx)] === 1) {
				near = true;
				break;
			}
		}
		if (near) nearWater[cellY * coarse + cellX] = 1;
	}
	world.waterNear = nearWater;
	return nearWater;
}
//#endregion
//#region src/sim/transit.ts
/** Vlastnosti módu z katalogu, nebo `undefined` u módu, který obsah nezná. */
function modeOf(balance, mode) {
	return balance.transit.modes[mode];
}
/**
* Je budova zastávkou daného módu?
*
* Ptá se katalogu, ne id budovy: mod si přidá vlastní zastávku a hra o ní
* nemusí vědět.
*/
function stopMode(world, catalogue, buildingId) {
	const building = world.buildings.get(buildingId);
	if (!building) return null;
	return catalogue.get(building.definitionId)?.transit?.mode ?? null;
}
/**
* Co je na lince špatně. Prázdné pole znamená „v pořádku".
*
* Vrací **všechny** problémy, ne první: hráč, který sestavuje linku, má vidět
* celý seznam, ne ho odkrývat po jednom.
*/
function lineProblems(world, catalogue, balance, line) {
	const problems = [];
	if (!modeOf(balance, line.mode)) problems.push("unknownMode");
	if (line.stops.length < balance.transit.minStops) problems.push("tooFewStops");
	if (line.stops.length > balance.transit.maxStops) problems.push("tooManyStops");
	const seen = /* @__PURE__ */ new Set();
	for (const stop of line.stops) {
		if (seen.has(stop)) {
			if (!problems.includes("duplicateStop")) problems.push("duplicateStop");
			continue;
		}
		seen.add(stop);
		const mode = stopMode(world, catalogue, stop);
		if (mode === null) {
			if (!problems.includes("notAStop")) problems.push("notAStop");
		} else if (mode !== line.mode) {
			if (!problems.includes("wrongMode")) problems.push("wrongMode");
		}
	}
	return problems;
}
/**
* Jede linka teď?
*
* Elektrická linka **nejezdí, když nemá proud** — tramvaj ani metro se bez
* elektřiny nehnou, a je to jeden z důvodů, proč blackout otevírá dveře všemu
* ostatnímu. Autobus jezdí dál; naftu blackout nezastaví.
*
* Stačí, aby byla bez proudu **jediná** zastávka: linka je jeden okruh, ne
* několik nezávislých kusů.
*/
function lineRuns(world, catalogue, balance, line) {
	if (line.vehicles <= 0) return false;
	if (lineProblems(world, catalogue, balance, line).length > 0) return false;
	if (!modeOf(balance, line.mode)?.needsPower) return true;
	for (const stop of line.stops) if (world.buildings.get(stop)?.powered !== true) return false;
	return true;
}
/**
* Silniční dlaždice, po kterých linka vede.
*
* Úsečka mezi sousedními zastávkami, oříznutá na to, co je opravdu silnice.
* Není to hledání cesty a schválně: trasa se nekreslí, tohle je jen odhad
* koridoru, aby tramvaj měla čemu ubrat kapacitu. Kdyby se hledala skutečná
* cesta, hráč by čekal, že po ní tramvaj i **pojede** — a ona nikam nejede,
* protože je to abstrakce.
*/
function corridorTiles(world, line) {
	const tiles = /* @__PURE__ */ new Set();
	for (let i = 1; i < line.stops.length; i++) {
		const from = world.buildings.get(line.stops[i - 1] ?? 0);
		const to = world.buildings.get(line.stops[i] ?? 0);
		if (!from || !to) continue;
		for (const tile of segment(world, from, to)) for (const near of aroundTile(world, tile)) if ((world.layers.road[near] ?? ROAD.none) !== ROAD.none) tiles.add(near);
	}
	return [...tiles].sort((a, b) => a - b);
}
/** Dlaždice a její čtyři sousedé, oříznuté na mapu. */
function aroundTile(world, tile) {
	const x = tile % world.size;
	const y = (tile - x) / world.size;
	const out = [tile];
	for (const [dx, dy] of [
		[0, -1],
		[1, 0],
		[0, 1],
		[-1, 0]
	]) {
		const nx = x + dx;
		const ny = y + dy;
		if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
		out.push(index(nx, ny, world.size));
	}
	return out;
}
/** Dlaždice úsečky mezi dvěma body včetně obou konců (Bresenham). */
function segment(world, from, to) {
	const tiles = [];
	let x = from.x;
	let y = from.y;
	const dx = Math.abs(to.x - x);
	const dy = -Math.abs(to.y - y);
	const stepX = x < to.x ? 1 : -1;
	const stepY = y < to.y ? 1 : -1;
	let error = dx + dy;
	const limit = world.size * 2;
	for (let step = 0; step < limit; step++) {
		if (x >= 0 && y >= 0 && x < world.size && y < world.size) tiles.push(index(x, y, world.size));
		if (x === to.x && y === to.y) break;
		const doubled = error * 2;
		if (doubled >= dy) {
			error += dy;
			x += stepX;
		}
		if (doubled <= dx) {
			error += dx;
			y += stepY;
		}
	}
	return tiles;
}
/**
* Přepočítá, které silnice ukusuje kolejová doprava.
*
* Drží se v `world.tramTiles` jako udržovaný seznam (R20): kolony se počítají
* z každé silniční dlaždice a ptát se přitom pokaždé na všechny linky by byl
* součin dvou velkých čísel.
*
* Kapacitu ubírá **kolej, ne provoz**: penalizace platí i během blackoutu, kdy
* tramvaje stojí. Koleje z vozovky nezmizí tím, že po nich nikdo nejede.
*/
function rebuildTramTiles(world, catalogue, balance) {
	world.tramTiles.clear();
	for (const line of world.lines) {
		const mode = modeOf(balance, line.mode);
		if (!mode || mode.roadShare <= 0) continue;
		if (lineProblems(world, catalogue, balance, line).length > 0) continue;
		for (const tile of corridorTiles(world, line)) {
			const worst = world.tramTiles.get(tile) ?? 0;
			world.tramTiles.set(tile, Math.max(worst, mode.roadShare));
		}
	}
	world.transitDirty = false;
}
/**
* Kolik kapacity zbývá silnici po kolejích, 0–1.
*
* Čte se z udržovaného seznamu, takže dotaz stojí jeden `Map.get`.
*/
function roadCapacityFactor(world, tile) {
	if (world.tramTiles.size === 0) return 1;
	return 1 - (world.tramTiles.get(tile) ?? 0);
}
function noStats() {
	return {
		demand: 0,
		capacity: 0,
		transported: 0,
		income: 0,
		upkeep: 0
	};
}
/**
* Kolik lidí je ochotno zaplatit dané jízdné, 0–1.
*
* Lineární pokles do nuly na `fareLimit`. Příjem je `přepraveno × jízdné`,
* takže součin dává parabolu: **zvýšení jízdného zvedne příjem jen do
* poloviny limitu, pak ho sráží.** Optimum se dá najít, a to je smysl —
* jízdné je rozhodnutí, ne posuvník s jedním správným koncem.
*/
function fareSensitivity(balance, fare) {
	const limit = balance.transit.fareLimit;
	if (limit <= 0) return 1;
	return Math.max(0, Math.min(1, 1 - fare / limit));
}
/**
* Buňky, které linka obsluhuje: dosah zastávek podle katalogu.
*
* Dosah je vlastnost **zastávky**, ne linky: metro obslouží víc než autobusová
* zastávka, protože k němu lidé dojdou dál. Sjednocené, ne sečtené — dvě
* zastávky vedle sebe nepokrývají tutéž ulici dvakrát.
*/
function servedCells(world, catalogue, line) {
	const cells = /* @__PURE__ */ new Set();
	const side = coarseSizeOf(world.size);
	for (const stop of line.stops) {
		const building = world.buildings.get(stop);
		if (!building) continue;
		const radius = catalogue.get(building.definitionId)?.service?.radius ?? 0;
		if (radius <= 0) continue;
		const origin = coarseIndex(building.x, building.y, world.size);
		const originX = origin % side;
		const originY = (origin - originX) / side;
		const reach = Math.ceil(radius);
		for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
			const cx = originX + dx;
			const cy = originY + dy;
			if (cx < 0 || cy < 0 || cx >= side || cy >= side) continue;
			if (Math.hypot(dx, dy) > radius) continue;
			cells.add(cy * side + cx);
		}
	}
	return [...cells].sort((a, b) => a - b);
}
/** Lidé po buňkách: obyvatelé i pracovní místa. Obojí někam jezdí. */
function ridersPerCell(world) {
	const perCell = /* @__PURE__ */ new Map();
	for (const building of world.buildings.values()) {
		if (building.abandoned) continue;
		const riders = building.population + building.jobs;
		if (riders <= 0) continue;
		const cell = coarseIndex(building.x, building.y, world.size);
		perCell.set(cell, (perCell.get(cell) ?? 0) + riders);
	}
	return perCell;
}
/**
* Rozdělí cestující mezi linky a spočítá, co která odveze.
*
* **Lidé jsou společný a konečný fond.** Linky se o ně dělí v pořadí podle id,
* každá si vezme, co unese, a další už bere jen ze zbytku. Bez toho by šlo
* postavit deset stejných linek přes jednu čtvrť a každá by vozila — a
* vydělávala — na týchž lidech.
*
* Zároveň z toho plyne přesně to, co má hráč poznat: **druhá linka přes tutéž
* čtvrť pomůže, až když je ta první plná.** Přidat vozidla je většinou lepší
* než přidat linku.
*/
function computeLineStats(world, catalogue, balance) {
	const total = ridersPerCell(world);
	const left = new Map(total);
	world.lineStats.clear();
	world.transitRelief.clear();
	for (const line of [...world.lines].sort((a, b) => a.id - b.id)) {
		const stats = noStats();
		world.lineStats.set(line.id, stats);
		const mode = modeOf(balance, line.mode);
		if (!mode) continue;
		stats.upkeep = line.vehicles * mode.vehicleUpkeep;
		if (!lineRuns(world, catalogue, balance, line)) continue;
		stats.capacity = line.vehicles * mode.capacity;
		const cells = servedCells(world, catalogue, line);
		let available = 0;
		for (const cell of cells) available += left.get(cell) ?? 0;
		stats.demand = available;
		if (available <= 0) continue;
		const willing = available * fareSensitivity(balance, line.fare);
		stats.transported = Math.min(stats.capacity, willing);
		stats.income = Math.round(stats.transported * line.fare);
		if (stats.transported <= 0) continue;
		const share = stats.transported / available;
		for (const cell of cells) {
			const here = left.get(cell) ?? 0;
			if (here <= 0) continue;
			const taken = here * share;
			left.set(cell, here - taken);
			const capacity = total.get(cell) ?? 0;
			if (capacity <= 0) continue;
			world.transitRelief.set(cell, (world.transitRelief.get(cell) ?? 0) + taken / capacity);
		}
	}
}
/** Kolik cest v buňce vezme MHD, 0–1. Čte doprava. */
function transitReliefAt(world, cell) {
	if (world.transitRelief.size === 0) return 0;
	return world.transitRelief.get(cell) ?? 0;
}
/** Součet přes všechny linky. Do rozpočtu. */
function transitTotals(world) {
	let income = 0;
	let upkeep = 0;
	let vehicles = 0;
	for (const line of world.lines) {
		const stats = world.lineStats.get(line.id);
		income += stats?.income ?? 0;
		upkeep += stats?.upkeep ?? 0;
		vehicles += line.vehicles;
	}
	return {
		income,
		upkeep,
		vehicles
	};
}
//#endregion
//#region src/sim/diagnostics.ts
function landValueContext(world, balance) {
	const services = [];
	for (const serviceClass of [...world.coverage.keys()].sort()) {
		const weight = balance.landValue.weights[serviceClass];
		const coverage = world.coverage.get(serviceClass);
		if (weight === void 0 || !coverage) continue;
		services.push([
			serviceClass,
			coverage,
			weight
		]);
	}
	return {
		water: waterProximity(world),
		forest: coarseTerrainShare(world, TERRAIN.forest),
		sand: coarseTerrainShare(world, TERRAIN.sand),
		congestion: coarseCongestion(world, balance),
		services,
		rubble: rubblePerCell(world),
		flood: floodPerCell(world)
	};
}
/**
* Vytížení silnic přenesené na hrubou mřížku.
*
* Průměruje se **přes silniční dlaždice v buňce**, ne přes všech šestnáct:
* jedna ucpaná ulice uprostřed pole není „šestnáctina problému", ale problém.
* Buňka bez silnice má nulu.
*/
function coarseCongestion(world, balance) {
	const cells = coarseCellsOf(world.size);
	const total = new Float32Array(cells);
	const counts = new Float32Array(cells);
	for (const tile of world.roadTiles) {
		const roadType = world.layers.road[tile] ?? ROAD.none;
		if (roadType === ROAD.none) continue;
		const capacity = (balance.traffic.roadTypes[roadType - 1]?.capacity ?? 0) * roadCapacityFactor(world, tile);
		if (capacity <= 0) continue;
		const x = tile % world.size;
		const cell = coarseIndex(x, (tile - x) / world.size, world.size);
		total[cell] = (total[cell] ?? 0) + Math.min(2, (world.trafficLoad[tile] ?? 0) / capacity);
		counts[cell] = (counts[cell] ?? 0) + 1;
	}
	for (let cell = 0; cell < total.length; cell++) {
		const count = counts[cell] ?? 0;
		total[cell] = count === 0 ? 0 : (total[cell] ?? 0) / count;
	}
	return total;
}
/**
* Surová cena půdy v jedné buňce. **Jediný vzorec v celé hře.**
*
* `collect` je volitelný sběrač sčítanců pro panel parcely. Když je `null`,
* nevznikne ani jeden objekt — a přesně tak to volá `landValueSystem`, který
* tenhle výpočet dělá pro každou buňku hrubé mřížky. Dokud se sčítance
* alokovaly vždycky, stálo šestnáct tisíc buněk velké mapy víc než všechno
* ostatní dohromady.
*
* Rozdělit to na „rychlou" a „vysvětlující" verzi by znamenalo dva vzorce a
* dřív nebo později dvě různá čísla — jedno pro hru, druhé pro hráče.
*/
function landValueRaw(world, balance, cell, context, collect) {
	const { base, waterBonus, weights } = balance.landValue;
	let raw = base;
	collect?.push({
		source: "base",
		input: 1,
		weight: base,
		amount: base
	});
	if (context.water[cell] === 1) {
		raw += waterBonus;
		collect?.push({
			source: "water",
			input: 1,
			weight: waterBonus,
			amount: waterBonus
		});
	}
	const congestion = context.congestion[cell] ?? 0;
	if (congestion > 0) {
		const weight = weights["congestion"] ?? 0;
		if (weight !== 0) {
			raw -= congestion * weight;
			collect?.push({
				source: "congestion",
				input: congestion,
				weight,
				amount: -congestion * weight
			});
		}
	}
	raw += addShare(collect, "forest", context.forest[cell] ?? 0, weights["forest"] ?? 0);
	raw += addShare(collect, "sand", context.sand[cell] ?? 0, weights["sand"] ?? 0);
	const services = context.services;
	for (let i = 0; i < services.length; i++) {
		const entry = services[i];
		if (!entry) continue;
		const input = entry[1][cell] ?? 0;
		if (input === 0) continue;
		raw += input * entry[2];
		collect?.push({
			source: entry[0],
			input,
			weight: entry[2],
			amount: input * entry[2]
		});
	}
	const rubble = context.rubble[cell] ?? 0;
	if (rubble > 0) {
		const perTile = balance.disasters.rubble.landValuePenalty / 16;
		const amount = Math.min(balance.disasters.rubble.landValuePenalty, rubble * perTile);
		raw -= amount;
		collect?.push({
			source: "rubble",
			input: rubble,
			weight: perTile,
			amount: -amount
		});
	}
	const flooded = context.flood[cell] ?? 0;
	if (flooded > 0) {
		const amount = flooded * balance.disasters.flood.landValuePenalty;
		raw -= amount;
		collect?.push({
			source: "flood",
			input: flooded,
			weight: balance.disasters.flood.landValuePenalty,
			amount: -amount
		});
	}
	raw -= addPenalty(collect, "pollution", world.coarse.pollution[cell] ?? 0, weights["pollution"] ?? 0);
	raw -= addPenalty(collect, "crime", world.coarse.crime[cell] ?? 0, weights["crime"] ?? 0);
	return raw;
}
/** Kladný sčítanec. Vrací příspěvek a případně ho zapíše do rozpisu. */
function addShare(collect, source, input, weight) {
	if (input === 0 || weight === 0) return 0;
	collect?.push({
		source,
		input,
		weight,
		amount: input * weight
	});
	return input * weight;
}
/** Záporný sčítanec. Vrací **kladnou** velikost srážky; volající ji odečte. */
function addPenalty(collect, source, input, weight) {
	if (input === 0) return 0;
	collect?.push({
		source,
		input,
		weight,
		amount: -input * weight
	});
	return input * weight;
}
//#endregion
//#region src/sim/systems/happiness.ts
/**
* Spokojenost (§9 zadání fáze 3).
*
* Jediné číslo, které hráč sleduje průběžně; ostatní veličiny otevírá, teprve
* když spokojenost klesá. Proto se skládá **ze všeho ostatního** — pokrytí
* službami, cena půdy, znečištění, kriminalita, kolony, daně, nezaměstnanost.
*
* Dvě věci o ní platí a obě jsou důležité:
*
* - **Neukládá se** (R10). Je odvozená ze stavu, který se ukládá, takže by se
*   v savu mohla rozejít se skutečností. Po načtení se do pár běhů dopočítá.
* - **Nevstupuje do ceny půdy.** Cena půdy do spokojenosti ano, obráceně ne —
*   jinak by vznikla kladná zpětná vazba (R2 z fáze 2 platí dál). Smyčka
*   poptávka → růst → hustota → doprava → kolony → spokojenost je záporná,
*   tedy stabilní.
*
* Vyhlazení proti skokům: hodnota se k surové jen přibližuje. Bez něj by
* postavení jediného divadla přepsalo celou čtvrť v jednom tiku.
*/
var INTERVAL$4 = 16;
var OFFSET$4 = 13;
function createHappinessSystem(balance) {
	return {
		name: "happiness",
		interval: INTERVAL$4,
		offset: OFFSET$4,
		run(world) {
			const { happiness } = balance;
			const congestion = coarseCongestion(world, balance);
			let population = 0;
			let jobs = 0;
			for (const building of world.buildings.values()) {
				if (building.abandoned) continue;
				population += building.population;
				jobs += building.jobs;
			}
			const workers = population * balance.demand.workerRatio;
			const unemployment = workers > 0 ? Math.max(0, Math.min(1, (workers - jobs) / workers)) : 0;
			const cityWide = world.economy.taxRates.residential * happiness.tax + unemployment * happiness.unemployment;
			const covers = [];
			const coverWeights = [];
			for (const [serviceClass, weight] of Object.entries(happiness.weights)) {
				const coverage = world.coverage.get(serviceClass);
				if (!coverage || weight === 0) continue;
				covers.push(coverage);
				coverWeights.push(weight);
			}
			for (let cell = 0; cell < world.happiness.length; cell++) {
				let raw = happiness.base - cityWide;
				for (let i = 0; i < covers.length; i++) raw += (covers[i]?.[cell] ?? 0) * (coverWeights[i] ?? 0);
				raw += (world.coarse.landValue[cell] ?? 0) * happiness.landValue;
				raw -= (world.coarse.pollution[cell] ?? 0) * happiness.pollution;
				raw -= (world.coarse.crime[cell] ?? 0) * happiness.crime;
				raw -= (congestion[cell] ?? 0) * happiness.congestion;
				raw -= strongestModifier(world, "happinessPenalty", cell, 0, void 0, Math.max);
				const previous = world.happiness[cell] ?? 0;
				const next = previous + (raw - previous) * happiness.smoothing;
				world.happiness[cell] = Math.max(0, Math.min(255, Math.round(next)));
			}
			world.dirty.coarseChanged = true;
		}
	};
}
/**
* Průměrná spokojenost města, 0–255.
*
* Počítá se **jen z obydlených buněk**: prázdná polovina mapy nemá koho
* potěšit ani naštvat, a kdyby se počítala, každé město by viselo kolem
* základní hodnoty bez ohledu na to, jak se v něm žije.
*/
function averageHappiness$1(world) {
	const coarseSize = Math.round(Math.sqrt(world.happiness.length));
	const populated = /* @__PURE__ */ new Set();
	for (const building of world.buildings.values()) {
		if (building.abandoned || building.population === 0) continue;
		const cellX = Math.floor(building.x / 4);
		const cellY = Math.floor(building.y / 4);
		populated.add(cellY * coarseSize + cellX);
	}
	if (populated.size === 0) return 0;
	let sum = 0;
	for (const cell of populated) sum += world.happiness[cell] ?? 0;
	return sum / populated.size;
}
/**
* Násobitel obytné poptávky podle spokojenosti (§9).
*
* **Moduluje, nevetuje** — stejná logika jako u dostupnosti práce (R6).
* Nespokojené město roste pomaleji, ale roste; nulový násobitel by hru zamkl
* v okamžiku, kdy je spokojenost nejnižší, tedy přesně když se hráč snaží
* situaci otočit.
*
* Dokud ve městě nikdo nebydlí, je to jednička: začínající město nemá koho se
* ptát a nesmí kvůli tomu stát.
*/
function happinessDemandFactor(world, balance) {
	let inhabited = false;
	for (const building of world.buildings.values()) if (!building.abandoned && building.population > 0) {
		inhabited = true;
		break;
	}
	if (!inhabited) return 1;
	const { minDemandFactor } = balance.happiness;
	const average = averageHappiness$1(world) / 255;
	return minDemandFactor + (1 - minDemandFactor) * Math.max(0, Math.min(1, average));
}
//#endregion
//#region src/sim/systems/demand.ts
/**
* RCI poptávka.
*
* Model je záměrně jednoduchý a stojí na jedné myšlence: **lidé chtějí práci
* a práce chce lidi.** Z toho vyjde celá smyčka §13 sama.
*
* - obytná: kladná, dokud je kam chodit do práce (plus základ, aby vůbec začalo)
* - průmyslová: kladná, když je víc pracujících než míst
* - komerční: kladná, když je víc lidí než obchodů
*
* Čísla jsou provizorní balanc, ne výsledek ladění — na to je T10.
*
* Od T39 se **kladná** obytná poptávka násobí spokojeností města (§9). Jen
* kladná: záporná poptávka znamená „bytů je dost“ a to s náladou nesouvisí —
* kdyby se násobila i ta, nespokojené město by hlásilo menší přebytek, tedy
* přesný opak toho, co se v něm děje.
*/
function createDemandSystem(catalogue, balance) {
	const { workerRatio, baseResidential, commercePerCapita, limit } = balance.demand;
	const clampDemand = (value) => Math.max(-limit, Math.min(limit, Math.round(value)));
	return {
		name: "demand",
		interval: 4,
		offset: 1,
		run(world) {
			let population = 0;
			let jobs = 0;
			let commercialJobs = 0;
			for (const building of world.buildings.values()) {
				population += building.population;
				jobs += building.jobs;
				if (catalogue.get(building.definitionId)?.category === "commercial") commercialJobs += building.jobs;
			}
			const workers = population * workerRatio;
			const rawResidential = baseResidential + (jobs - workers);
			const happiness = happinessDemandFactor(world, balance);
			world.demand.residential = clampDemand(rawResidential > 0 ? rawResidential * happiness : rawResidential);
			world.demand.industrial = clampDemand(workers - jobs);
			world.demand.commercial = clampDemand(population * commercePerCapita - commercialJobs);
		}
	};
}
//#endregion
//#region src/sim/finance.ts
/**
* Měsíční splátky. Vrací, kolik splátek město nezvládlo.
*
* Nezvládnutá splátka se **neodpouští ani nehromadí do skoku**: dluh zůstane,
* měsíc se nepočítá jako splacený a rating klesne. Kdyby se nesplacená splátka
* jen odložila, nesplácení by nic nestálo; kdyby se strhla do mínusu, spadlo by
* město do díry, ze které ho má půjčka zrovna dostat.
*/
function payLoans(world, balance) {
	if (world.loans.length === 0) return 0;
	let missed = 0;
	const finance = balance.finance;
	for (const loan of world.loans) {
		const due = Math.min(loan.payment, loan.remaining);
		if (world.economy.funds < due) {
			missed++;
			continue;
		}
		world.economy.funds -= due;
		loan.remaining -= due;
		loan.paidMonths++;
	}
	world.loans = world.loans.filter((loan) => loan.remaining > 0);
	const rating = world.economy.creditRating;
	const next = missed > 0 ? rating - missed * finance.missedPenalty : rating + (world.loans.length > 0 ? finance.ratingRecovery : finance.ratingRecovery / 2);
	world.economy.creditRating = Math.max(0, Math.min(1, next));
	return missed;
}
/**
* Platí podmínka grantu právě teď?
*
* Jména veličin zná kód, hodnoty a prahy jsou obsah (P5). Neznámá veličina
* vrací `false` — mod si smí přidat vlastní milník, jen ho tahle verze hry
* nepřizná, místo aby spadla.
*/
function grantConditionHolds(world, catalogue, grant) {
	const { metric, atLeast, definitionId } = grant.condition;
	switch (metric) {
		case "population": return totalPopulation$1(world) >= atLeast;
		case "buildings": return world.buildings.size >= atLeast;
		case "happiness": return averageHappiness(world) >= atLeast;
		case "building": {
			if (definitionId === void 0) return false;
			let count = 0;
			for (const building of world.buildings.values()) {
				if (building.definitionId !== definitionId || building.abandoned) continue;
				count++;
				if (count >= Math.max(1, atLeast)) return true;
			}
			return false;
		}
		default: return false;
	}
}
/**
* Přizná granty, na které město dosáhlo. Vrací id přiznaných.
*
* Podmínka s `forTicks` musí platit **v kuse**. Bez toho by šel grant za
* spokojenost sebrat tím, že hráč na jediný tik srazí daně na nulu, vybere si
* odměnu a hned je vrátí zpátky.
*/
function awardGrants(world, catalogue, grants) {
	const awarded = [];
	for (const grant of grants) {
		if (world.grantsAwarded.has(grant.id)) continue;
		if (!grantConditionHolds(world, catalogue, grant)) {
			world.grantProgress.delete(grant.id);
			continue;
		}
		const needed = grant.condition.forTicks ?? 0;
		if (needed > 0) {
			const held = (world.grantProgress.get(grant.id) ?? 0) + 1;
			if (held < needed) {
				world.grantProgress.set(grant.id, held);
				continue;
			}
		}
		world.grantsAwarded.add(grant.id);
		world.grantProgress.delete(grant.id);
		world.economy.funds += grant.amount;
		awarded.push(grant.id);
	}
	return awarded;
}
function totalPopulation$1(world) {
	let total = 0;
	for (const building of world.buildings.values()) {
		if (building.abandoned) continue;
		total += building.population;
	}
	return total;
}
function averageHappiness(world) {
	if (world.happiness.length === 0) return 0;
	let sum = 0;
	for (const value of world.happiness) sum += value;
	return sum / world.happiness.length;
}
/** Kolik město dluží. Do rozpočtu i do panelu. */
function totalDebt(world) {
	return world.loans.reduce((sum, loan) => sum + loan.remaining, 0);
}
/** Měsíční splátky dohromady. Do rozpočtu. */
function monthlyPayments(world) {
	return world.loans.reduce((sum, loan) => sum + Math.min(loan.payment, loan.remaining), 0);
}
/** Rok má 360 tiků (§5). Kupón se vyplácí jednou za rok. */
var YEAR = 360;
/**
* Roční kupóny a splatné jistiny. Vrací, co se nezvládlo zaplatit.
*
* Nezaplacený **kupón** je jen ostuda: rating klesne jako u půjčky, dluh
* zůstane. Nesplacená **jistina** je jiná liga — sráží rating výrazně a na
* několik let znemožní další emisi. Kdo nezaplatí, tomu příště nikdo nepůjčí.
*/
function serviceBonds(world, balance) {
	if (world.bonds.length === 0) return {
		missedCoupons: 0,
		defaults: 0
	};
	const settings = balance.finance.bonds;
	let missedCoupons = 0;
	let defaults = 0;
	for (const bond of world.bonds) {
		if (bond.defaulted) continue;
		if (world.tick - bond.lastCouponTick >= YEAR) {
			const coupon = Math.round(bond.subscribed * bond.rate / 100);
			if (world.economy.funds >= coupon) {
				world.economy.funds -= coupon;
				bond.lastCouponTick += YEAR;
			} else {
				missedCoupons++;
				bond.lastCouponTick += YEAR;
			}
		}
		if (world.tick < bond.maturityTick) continue;
		if (world.economy.funds >= bond.subscribed) {
			world.economy.funds -= bond.subscribed;
			bond.defaulted = false;
			bond.subscribed = 0;
		} else {
			bond.defaulted = true;
			defaults++;
			world.bondsBlockedUntil = world.tick + settings.blockTicks;
		}
	}
	world.bonds = world.bonds.filter((bond) => bond.subscribed > 0 || bond.defaulted);
	if (missedCoupons > 0 || defaults > 0) {
		const penalty = missedCoupons * balance.finance.missedPenalty + defaults * settings.defaultPenalty;
		world.economy.creditRating = Math.max(0, world.economy.creditRating - penalty);
	}
	return {
		missedCoupons,
		defaults
	};
}
/** Kolik město dluží na dluhopisech. Do rozpočtu a do panelu. */
function bondDebt(world) {
	return world.bonds.reduce((sum, bond) => sum + bond.subscribed, 0);
}
/** Roční kupóny dohromady. Do rozpočtu. */
function annualCoupons(world) {
	return world.bonds.reduce((sum, bond) => sum + (bond.defaulted ? 0 : Math.round(bond.subscribed * bond.rate / 100)), 0);
}
/** Zapíše populaci, proti které se příště měří růst. Volá měsíční uzávěrka. */
function rememberPopulation(world) {
	world.economy.lastPopulation = totalPopulation$1(world);
}
//#endregion
//#region src/sim/systems/economy.ts
/**
* Daň ze zdaňovaného základu. Jediný daňový vzorec v celé hře — používá ho
* rozpočet i detail budovy, takže se výpis nemůže rozejít se skutečností.
*/
function taxFrom(base, ratePercent, valuePerUnit) {
	return Math.round(base * valuePerUnit * ratePercent / 100);
}
/**
* Údržba budovy za měsíc.
*
* Temná budova je mimo provoz, takže neplatí nic. U služeb se údržba škáluje
* financováním třídy — kdo šetří na policii, platí za ni míň, ale i dosah
* je menší (§6 zadání fáze 2).
*/
function buildingMonthlyUpkeep(world, definition, building) {
	if (building.abandoned) return 0;
	if (isRciCategory(definition.category) && !building.powered) return 0;
	const serviceClass = definition.service?.class;
	const funding = serviceClass === void 0 ? 1 : serviceFunding(world, serviceClass);
	return Math.round(definition.economy.upkeep * funding);
}
/**
* Kolik daně budově ubírá běžící katastrofa, 0–1.
*
* Postihy se neskládají — platí ten nejhorší (`Math.max`), stejně jako všude
* jinde v `effects.ts`. Dvě stávky přes jednu čtvrť nedaní dvakrát nula.
*/
function taxLossAt(world, tile) {
	if (world.disasters.modifiers.length === 0) return 0;
	return strongestModifier(world, "taxLoss", cellOfTile(world, tile), 0, void 0, Math.max);
}
/**
* Rozpad měsíčního rozpočtu po definicích.
*
* Sdílí ho `economySystem` i tabulka v UI, aby daňový vzorec existoval jen
* na jednom místě — jinak by se výpis a skutečnost dřív nebo později rozešly.
*/
function computeBudget(world, catalogue, balance) {
	const byDefinition = /* @__PURE__ */ new Map();
	let income = 0;
	let expenses = 0;
	for (const building of world.buildings.values()) {
		const definition = catalogue.get(building.definitionId);
		if (!definition) continue;
		const category = definition.category;
		const taxedAs = isRciCategory(category) ? category : null;
		/** Temná i opuštěná budova je mimo provoz: nedaní a neplatí údržbu. */
		const operating = !building.abandoned && (taxedAs === null || building.powered);
		let line = byDefinition.get(definition.id);
		if (!line) {
			line = {
				definitionId: definition.id,
				nameKey: definition.name,
				count: 0,
				poweredCount: 0,
				income: 0,
				upkeep: 0,
				taxBase: 0,
				taxUnitKey: taxedAs === null ? null : taxedAs === "residential" ? "ui.budget.unit.population" : "ui.budget.unit.jobs",
				taxRate: taxedAs === null ? null : world.economy.taxRates[taxedAs],
				upkeepEach: definition.economy.upkeep,
				upkeepCount: 0
			};
			byDefinition.set(definition.id, line);
		}
		line.count++;
		if (building.powered) line.poweredCount++;
		if (!operating) continue;
		line.upkeepCount++;
		if (taxedAs !== null) {
			const taxable = taxedAs === "residential" ? building.population : building.jobs;
			const lost = taxLossAt(world, index(building.x, building.y, world.size));
			line.taxBase += lost === 0 ? taxable : taxable - Math.round(taxable * lost);
		}
		const upkeep = buildingMonthlyUpkeep(world, definition, building);
		line.upkeepEach = upkeep;
		line.upkeep += upkeep;
		expenses += upkeep;
	}
	const roads = {
		count: 0,
		upkeep: 0
	};
	for (const tile of world.roadTiles) {
		const value = world.layers.road[tile] ?? ROAD.none;
		if (value === ROAD.none) continue;
		roads.count++;
		roads.upkeep += balance.traffic.roadTypes[value - 1]?.upkeep ?? 0;
	}
	roads.upkeep = Math.round(roads.upkeep);
	expenses += roads.upkeep;
	const totals = transitTotals(world);
	const transit = {
		lines: world.lines.length,
		vehicles: totals.vehicles,
		income: totals.income,
		upkeep: totals.upkeep
	};
	income += transit.income;
	expenses += transit.upkeep;
	const debt = {
		loans: world.loans.length,
		owed: totalDebt(world),
		payment: monthlyPayments(world),
		bonds: world.bonds.length,
		bondOwed: bondDebt(world),
		bondPayment: Math.round(annualCoupons(world) / 12)
	};
	expenses += debt.payment + debt.bondPayment;
	for (const line of byDefinition.values()) {
		if (line.taxRate === null) continue;
		line.income = taxFrom(line.taxBase, line.taxRate, balance.economy.taxableValuePerUnit);
		income += line.income;
	}
	return {
		lines: [...byDefinition.values()].sort((a, b) => a.definitionId.localeCompare(b.definitionId)),
		roads,
		transit,
		debt,
		income,
		expenses,
		valuePerUnit: balance.economy.taxableValuePerUnit
	};
}
function createEconomySystem(catalogue, balance) {
	return {
		name: "economy",
		interval: 30,
		offset: 0,
		run(world) {
			const budget = computeBudget(world, catalogue, balance);
			world.economy.lastIncome = budget.income;
			world.economy.lastExpenses = budget.expenses;
			world.economy.funds += budget.income - budget.expenses;
		}
	};
}
//#endregion
//#region src/sim/diffusion.ts
/**
* Difuze na hrubé mřížce (§3 zadání fáze 2).
*
* Jeden průchod pro každou buňku:
* ```
* sousedé = součet 8 sousedů z předchozího průchodu
* nová    = zdroj + předchozí * (1 - spread) + sousedé * spread / 8
* nová   *= decay
* ```
*
* **Okraj mapy pohlcuje** — buňka mimo mřížku se počítá jako nula, takže se
* u kraje nic nehromadí.
*
* Konvergence: bez zdroje hodnota exponenciálně klesá, protože `decay < 1`.
* Se stálým zdrojem se ustálí zhruba na `zdroj / (1 - decay)`; podle toho se
* volí hodnoty `pollution` v definicích, aby se vešly pod 255.
*/
function diffuse(current, sources, spread, decay, passes) {
	const size = Math.round(Math.sqrt(current.length));
	let previous = Float32Array.from(current);
	let next = new Float32Array(current.length);
	for (let pass = 0; pass < passes; pass++) {
		for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
			const at = y * size + x;
			let neighbours = 0;
			for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
				if (dx === 0 && dy === 0) continue;
				const nx = x + dx;
				const ny = y + dy;
				if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
				neighbours += previous[ny * size + nx] ?? 0;
			}
			const value = (sources[at] ?? 0) + (previous[at] ?? 0) * (1 - spread) + neighbours * spread / 8;
			next[at] = value * decay;
		}
		const swap = previous;
		previous = next;
		next = swap;
	}
	for (let i = 0; i < current.length; i++) current[i] = Math.max(0, Math.min(255, Math.floor(previous[i] ?? 0)));
}
//#endregion
//#region src/sim/systems/pollution.ts
/**
* Znečištění (§3 a §6 zadání fáze 2).
*
* Zdroje jsou dva:
* 1. **Budovy** — každá přičte svou hodnotu `environment.pollution` do buňky,
*    ve které leží její přední roh.
* 2. **Odpad** — populace ho vyrábí, skládky a spalovny mají kapacitu a
*    nepokrytý zbytek jde do vzduchu **celoměstsky**, tedy rovnoměrně do každé
*    buňky. Skládka je levná a sama silně znečišťuje své okolí, spalovna je
*    drahá a znečišťuje méně — čistý prostorový kompromis bez nové vrstvy.
*
* Všechny konstanty jdou z `balance.json` (§10) — v kódu není ani jedna.
*/
function createPollutionSystem(catalogue, balance) {
	return {
		name: "pollution",
		interval: 8,
		offset: 3,
		run(world) {
			const sources = new Float32Array(coarseCellsOf(world.size));
			let population = 0;
			let wasteCapacity = 0;
			let sewageCapacity = 0;
			for (const building of world.buildings.values()) {
				if (building.abandoned) continue;
				population += building.population;
				const definition = catalogue.get(building.definitionId);
				if (!definition) continue;
				wasteCapacity += definition.waste?.capacity ?? 0;
				sewageCapacity += definition.sewage?.capacity ?? 0;
				const emitted = definition.environment?.pollution ?? 0;
				if (emitted <= 0) continue;
				const [width, depth] = definition.footprint;
				const at = coarseIndex(Math.min(building.x + width - 1, world.size - 1), Math.min(building.y + depth - 1, world.size - 1), world.size);
				sources[at] = (sources[at] ?? 0) + emitted;
			}
			const generatedWaste = population * balance.waste.perCitizen;
			const unhandledWaste = Math.max(0, generatedWaste - wasteCapacity);
			const generatedSewage = population * balance.sewage.perCitizen;
			const unhandledSewage = Math.max(0, generatedSewage - sewageCapacity);
			const cityWide = unhandledWaste * balance.waste.toPollution + unhandledSewage * balance.sewage.toPollution;
			if (cityWide > 0) for (let cell = 0; cell < sources.length; cell++) sources[cell] = (sources[cell] ?? 0) + cityWide;
			const { spread, decay, passes } = balance.diffusion;
			diffuse(world.coarse.pollution, sources, spread, decay, passes);
			const forest = coarseTerrainShare(world, TERRAIN.forest);
			const { forestAbsorption } = balance.map;
			if (forestAbsorption > 0) for (let cell = 0; cell < world.coarse.pollution.length; cell++) {
				const share = forest[cell] ?? 0;
				if (share === 0) continue;
				const kept = 1 - share * forestAbsorption;
				world.coarse.pollution[cell] = Math.floor((world.coarse.pollution[cell] ?? 0) * kept);
			}
			world.dirty.coarseChanged = true;
		}
	};
}
//#endregion
//#region src/sim/systems/services.ts
/**
* Pokrytí službami (§6 zadání fáze 2).
*
* Mechanismus je obecný — třída, dosah a síla jsou obsah, kód nezná ani jednu
* konkrétní službu (P5). Příspěvky se sčítají a ořezávají na 255, takže dvě
* stanice vedle sebe jsou lepší než jedna, ale se snižujícím se přínosem.
*
* ```
* r    = radius * financování
* síla = strength * financování
* coverage[třída][c] += síla * (1 - d / r)     pro d ≤ r
* ```
*
* Běží každý tik, ale počítá jen při `coverageDirty` — po vzoru elektřiny.
* Bez toho by se 1024 buněk krát počet stanic přepočítávalo čtyřikrát za sekundu
* pro nic.
*/
function createServiceSystem(catalogue) {
	return {
		name: "services",
		interval: 1,
		offset: 0,
		run(world) {
			if (!world.coverageDirty) return;
			world.coverageDirty = false;
			const accumulated = /* @__PURE__ */ new Map();
			for (const id of [...world.buildings.keys()].sort((a, b) => a - b)) {
				const building = world.buildings.get(id);
				const definition = building && catalogue.get(building.definitionId);
				if (!building || !definition) continue;
				for (const [source, funded] of [[definition.service, true], [definition.nuisance, false]]) {
					if (!source) continue;
					if (funded && !building.powered) continue;
					const funding = funded ? serviceFunding(world, source.class) : 1;
					const radius = source.radius * funding;
					const strength = source.strength * funding;
					if (radius <= 0 || strength <= 0) continue;
					let field = accumulated.get(source.class);
					if (!field) {
						field = new Float32Array(coarseCellsOf(world.size));
						accumulated.set(source.class, field);
					}
					addCoverage(field, world.size, building, definition.footprint, radius, strength);
				}
			}
			writeCoverage(world, accumulated);
			world.dirty.coarseChanged = true;
		}
	};
}
function addCoverage(field, size, building, footprint, radius, strength) {
	const coarseSize = coarseSizeOf(size);
	const [width, depth] = footprint;
	const centerTileX = Math.min(building.x + (width - 1) / 2, size - 1);
	const centerTileY = Math.min(building.y + (depth - 1) / 2, size - 1);
	const origin = coarseIndex(Math.floor(centerTileX), Math.floor(centerTileY), size);
	const originX = origin % coarseSize;
	const originY = (origin - originX) / coarseSize;
	const reach = Math.ceil(radius);
	for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
		const cellX = originX + dx;
		const cellY = originY + dy;
		if (cellX < 0 || cellY < 0 || cellX >= coarseSize || cellY >= coarseSize) continue;
		const distance = Math.sqrt(dx * dx + dy * dy);
		if (distance > radius) continue;
		const at = cellY * coarseSize + cellX;
		field[at] = (field[at] ?? 0) + strength * (1 - distance / radius);
	}
}
/**
* Přepíše mapu pokrytí. Třídy, které ve městě zmizely, se vynulují — kdyby se
* jen přeskočily, po zbourání poslední stanice by pokrytí zůstalo viset.
*/
function writeCoverage(world, accumulated) {
	for (const [serviceClass, field] of accumulated) {
		let target = world.coverage.get(serviceClass);
		if (!target) {
			target = new Uint8Array(coarseCellsOf(world.size));
			world.coverage.set(serviceClass, target);
		}
		for (let cell = 0; cell < target.length; cell++) {
			const factor = strongestModifier(world, "suppressService", cell, 1, serviceClass);
			target[cell] = Math.max(0, Math.min(255, Math.round((field[cell] ?? 0) * factor)));
		}
	}
	for (const [serviceClass, target] of world.coverage) if (!accumulated.has(serviceClass)) target.fill(0);
}
//#endregion
//#region src/sim/systems/crime.ts
/**
* Kriminalita (§5 zadání fáze 2). Interval 16, offset 11 — schválně jinde než
* cena půdy, aby dvě difuzní vrstvy nespadly do stejného snímku.
*
* ```
* surová = hustotaPopulace × VÁHA + nezaměstnanost × VÁHA
*        + opuštěné × VÁHA − pokrytí[police] × VÁHA
* crime  = lerp(crime, surová, VYHLAZENÍ)
* ```
*
* **Kriminalita se neodvozuje od ceny půdy** (rozhodnutí R3 v zadání). Kdyby
* nízká cena půdy plodila kriminalitu a kriminalita srážela cenu půdy, každá
* čtvrť, která jednou klesne, už by se nikdy nezvedla.
*
* Opuštěná budova je zdroj sama o sobě: ruina táhne čtvrť dolů bez ohledu na
* to, kolik v ní kdysi bydlelo lidí. Cenu půdy sráží právě přes kriminalitu —
* vlastní kanál by znamenal další hrubou vrstvu a ta se do savu podle §11
* nevejde.
*
* Konstanty jdou z `balance.json` (§10).
*/
function createCrimeSystem(balance) {
	return {
		name: "crime",
		interval: 16,
		offset: 11,
		run(world) {
			const cells = coarseCellsOf(world.size);
			const density = new Float32Array(cells);
			const ruins = new Float32Array(cells);
			let population = 0;
			let jobs = 0;
			const rubbleWeight = balance.disasters.rubble.crimeWeight;
			for (let tile = 0; tile < world.rubble.length; tile++) {
				if ((world.rubble[tile] ?? 0) === 0) continue;
				const x = tile % world.size;
				const at = coarseIndex(x, (tile - x) / world.size, world.size);
				ruins[at] = (ruins[at] ?? 0) + rubbleWeight;
			}
			for (const building of world.buildings.values()) {
				const at = coarseIndex(building.x, building.y, world.size);
				if (building.abandoned) {
					ruins[at] = (ruins[at] ?? 0) + 1;
					continue;
				}
				population += building.population;
				jobs += building.jobs;
				if (building.population === 0) continue;
				density[at] = (density[at] ?? 0) + building.population;
			}
			const workers = population * balance.demand.workerRatio;
			const unemploymentTerm = (workers > 0 ? Math.max(0, Math.min(1, (workers - jobs) / workers)) : 0) * balance.crime.unemployment;
			const police = coverageOf(world, "police");
			const crime = world.coarse.crime;
			for (let cell = 0; cell < crime.length; cell++) {
				const raw = (density[cell] ?? 0) * balance.crime.population + (ruins[cell] ?? 0) * balance.crime.abandoned + unemploymentTerm - (police?.[cell] ?? 0) * balance.crime.police;
				const current = crime[cell] ?? 0;
				const delta = raw - current;
				const next = current + delta * balance.crime.smoothing;
				const stepped = delta > 0 ? Math.ceil(next) : Math.floor(next);
				const spike = strongestModifier(world, "spikeCrime", cell, 0, void 0, Math.max);
				const floor = strongestModifier(world, "crimeFloor", cell, 0, void 0, Math.max);
				crime[cell] = Math.max(0, Math.min(255, Math.max(stepped + spike, floor)));
			}
			world.dirty.coarseChanged = true;
		}
	};
}
//#endregion
//#region src/sim/systems/health.ts
/**
* Zdravotní péče (§6 zadání fáze 2, třída `health`).
*
* Bez pokrytí obyvatel v budovách **pomalu ubývá**, s pokrytím se zase vrací
* ke kapacitě z definice. Je to jediná třída služby, která kromě ceny půdy
* sahá i na entity — proto vlastní systém a ne řádek ve vzorci.
*
* Ubývá pomalu schválně: hráč má mít čas si problému všimnout dřív, než mu
* čtvrť vymře.
*
* `unservedRatio` je podlaha poklesu. Bez ní by město bez kliniky vymřelo na
* nulu, a protože na začátku hry žádná klinika nestojí, byl by to nevyhnutelný
* konec. Odhalil to test savu, kterému po 600 ticích vyšla nulová populace.
* Zdravotnictví je tak pobídka k růstu, ne past.
*
* Konstanty jdou z `balance.json` (§10).
*/
var INTERVAL$3 = 16;
/**
* Offset mimo cenu půdy (5), kriminalitu (11) i spokojenost (13).
*
* Třináctku uvolnil T39: spokojenost ji má v zadání fáze 3 a zdravotnictví
* si ji vybralo jen jako první volné číslo. Smysl offsetů je, aby drahé
* systémy nespadly do stejného tiku — dvě šestnáctky na jednom offsetu ten
* smysl ruší.
*/
var OFFSET$3 = 15;
function createHealthSystem(catalogue, balance) {
	return {
		name: "health",
		interval: INTERVAL$3,
		offset: OFFSET$3,
		run(world) {
			const coverage = coverageOf(world, "health");
			for (const building of world.buildings.values()) {
				if (building.abandoned) continue;
				const capacity = catalogue.get(building.definitionId)?.population?.capacity ?? 0;
				if (capacity === 0) continue;
				const covered = (coverage?.[coarseIndex(building.x, building.y, world.size)] ?? 0) >= balance.health.coverageThreshold;
				const floor = Math.ceil(capacity * balance.health.unservedRatio);
				const next = covered ? Math.min(capacity, building.population + balance.health.recoveryStep) : Math.max(floor, building.population - balance.health.declineStep);
				if (next === building.population) continue;
				building.population = next;
				markBuildingDirty(world, building.id);
			}
		}
	};
}
//#endregion
//#region src/sim/systems/traffic.ts
/**
* Dopravní model (§5 zadání fáze 3).
*
* **Vzorkování náhodných cest po vzoru Micropolisu** (rozhodnutí autora): z
* každého domu se vypustí pár chodců, ti se náhodně toulají po silnicích a
* počítá se, kolik jich narazí na práci. Není to hledání nejkratší cesty a
* záměrně: výsledek je „jak snadno se odsud dostanu do práce", což je přesně
* ta veličina, která má řídit růst.
*
* Dvě věci z toho plynou:
* - **`trafficLoad`** — kudy chodci šli, tedy zatížení silnic. Kolony z něj
*   dělá T26.
* - **`jobAccess`** — podíl úspěšných cest, vyhlazený v čase.
*
* Cesta se **nevrací tam, odkud přišla**. Bez toho se náhodná procházka zacyklí
* mezi dvěma dlaždicemi a nikam nedojde.
*
* Vzorkuje se, protože při tisících budov by se každý běh procházelo celé
* město. Kde se skončilo, drží `world.trafficCursor` — a ten je součástí savu,
* jinak by se po načtení začalo od začátku a determinismus by padl.
*/
var INTERVAL$2 = 8;
/** Offset mimo znečištění (8/3), aby dva průchody mapou nespadly do stejného tiku. */
var OFFSET$2 = 4;
var NEIGHBOURS$2 = [
	[0, -1],
	[1, 0],
	[0, 1],
	[-1, 0]
];
function createTrafficSystem(catalogue, balance) {
	return {
		name: "traffic",
		interval: INTERVAL$2,
		offset: OFFSET$2,
		run(world) {
			world.trafficLoad.fill(0);
			const homes = residentialBuildings(world, catalogue);
			if (homes.length === 0) return;
			const destinations = jobTiles(world, catalogue);
			const sample = takeSample(world, homes, balance.traffic.maxBuildingsPerRun);
			for (const building of sample) {
				const footprint = catalogue.get(building.definitionId)?.footprint ?? [1, 1];
				world.jobAccess.set(building.id, walkFrom(world, balance, building, footprint, destinations, world.jobAccess.get(building.id) ?? 0));
			}
		}
	};
}
/** Obytné budovy v pevném pořadí podle id — vzorek musí být deterministický. */
function residentialBuildings(world, catalogue) {
	const homes = [];
	for (const id of [...world.buildings.keys()].sort((a, b) => a - b)) {
		const building = world.buildings.get(id);
		if (!building || building.abandoned || building.population === 0) continue;
		if (catalogue.get(building.definitionId)?.category !== "residential") continue;
		homes.push(building);
	}
	return homes;
}
/**
* Silniční dlaždice, ze kterých je na dosah práce.
*
* „Volná místa" nesledujeme po budovách — zaměstnanost je v téhle hře veličina
* celoměstská, ne per budova (§7 fáze 1). Cílem je proto každá komerční nebo
* průmyslová budova, která nějaká místa má a jede.
*/
function jobTiles(world, catalogue) {
	const tiles = new Uint8Array(world.layers.road.length);
	for (const building of world.buildings.values()) {
		if (building.abandoned || building.jobs === 0) continue;
		const definition = catalogue.get(building.definitionId);
		const category = definition?.category;
		if (category !== "commercial" && category !== "industrial") continue;
		const [width, depth] = definition?.footprint ?? [1, 1];
		forEachRoadAround(world, building.x, building.y, width, depth, (tile) => {
			tiles[tile] = 1;
		});
	}
	return tiles;
}
/** Zavolá `visit` pro každou silniční dlaždici sousedící s obdélníkem. */
function forEachRoadAround(world, x, y, width, depth, visit) {
	for (let dy = -1; dy <= depth; dy++) for (let dx = -1; dx <= width; dx++) {
		if (!(dx === -1 || dy === -1 || dx === width || dy === depth)) continue;
		const tx = x + dx;
		const ty = y + dy;
		if (tx < 0 || ty < 0 || tx >= world.size || ty >= world.size) continue;
		const tile = index(tx, ty, world.size);
		if ((world.layers.road[tile] ?? ROAD.none) !== ROAD.none) visit(tile);
	}
}
/**
* Vybere z kruhu budov ty, na které tenhle běh vyšlo.
*
* Kurzor se posouvá i tehdy, když je budov míň než strop — jinak by se u malého
* města pořád dokola vzorkovaly tytéž a `trafficCursor` by nic neznamenal.
*/
function takeSample(world, homes, limit) {
	const count = Math.min(limit, homes.length);
	const sample = [];
	for (let i = 0; i < count; i++) {
		const building = homes[(world.trafficCursor + i) % homes.length];
		if (building) sample.push(building);
	}
	world.trafficCursor = (world.trafficCursor + count) % homes.length;
	return sample;
}
/**
* Vypustí z budovy chodce a vrátí novou vyhlazenou dosažitelnost práce.
*
* Dům bez silnice v sousedství má dosažitelnost nula — a je to tak správně,
* odnikud se nikam nedojde.
*/
function walkFrom(world, balance, building, footprint, destinations, previous) {
	const starts = startTiles(world, balance, building, footprint);
	if (starts.length === 0) return 0;
	const { attempts, maxSteps, smoothing } = balance.traffic;
	const weight = building.population / attempts * transitFactor(world, balance, building);
	let hits = 0;
	for (let attempt = 0; attempt < attempts; attempt++) {
		let position = starts[world.rng.int(starts.length)] ?? starts[0] ?? 0;
		let previousTile = -1;
		for (let step = 0; step < maxSteps; step++) {
			world.trafficLoad[position] = (world.trafficLoad[position] ?? 0) + weight;
			if (destinations[position] === 1) {
				hits++;
				break;
			}
			const next = neighbourRoads(world, position, previousTile);
			if (next.length === 0) break;
			previousTile = position;
			position = next[world.rng.int(next.length)] ?? position;
		}
	}
	return previous + (hits / attempts - previous) * smoothing;
}
/**
* O kolik MHD ubere téhle budově dopravy (§6 fáze 3, §7 fáze 4).
*
* Ve 3a stačilo **pokrytí zastávkou**: stála-li poblíž zastávka, čtvrť jezdila
* míň autem. Od T56 rozhoduje **kolik lidí linka opravdu odveze** —
* `přepraveno / poptávka`. Linka s jedním autobusem a deseti tisíci obyvateli
* v dosahu prakticky nepomůže, a to je smysl: zastávka sama o sobě nikoho
* nikam nedopraví.
*
* Ubírá se **zátěž na silnicích, ne dosažitelnost práce**: obsloužená čtvrť
* jezdí míň autem, ale do práce se z ní dostane pořád stejně dobře. Kdyby
* zastávka zvedala i `jobAccess`, byla by to zkratka, jak růst rozjet úplně bez
* silnic — a to je model, který tahle hra nemá.
*
* Plná obsluha sebere `transitReduction`, ne všechno; i s dokonalou MHD něco
* po silnicích jezdí dál.
*/
function transitFactor(world, balance, building) {
	const reduction = balance.traffic.transitReduction;
	if (reduction <= 0) return 1;
	const relief = transitReliefAt(world, coarseIndex(building.x, building.y, world.size));
	return 1 - Math.max(0, Math.min(1, relief)) * reduction;
}
/**
* Odkud chodec vyráží: nejbližší silnice **v dosahu růstu**, ne nutně hned
* vedle domu.
*
* Kdyby se trvalo na sousedství, polovina domů by měla dosažitelnost práce
* nula napořád — růst je totiž staví až tři dlaždice od vozovky (§9 fáze 2).
* Ukázalo se to hned na první zkoušce ve hře: 17 z 32 domů nemělo odkud vyjít.
* Dosah proto sdílí obě pravidla, ať si neodporují.
*/
function startTiles(world, balance, building, footprint) {
	const maxDistance = balance.growth.roadFactors.length - 1;
	const seen = /* @__PURE__ */ new Set();
	let frontier = [];
	for (let dy = 0; dy < footprint[1]; dy++) for (let dx = 0; dx < footprint[0]; dx++) {
		const tx = building.x + dx;
		const ty = building.y + dy;
		if (tx < 0 || ty < 0 || tx >= world.size || ty >= world.size) continue;
		const tile = index(tx, ty, world.size);
		seen.add(tile);
		frontier.push(tile);
	}
	for (let step = 0; step <= maxDistance && frontier.length > 0; step++) {
		const roads = [];
		const next = [];
		for (const tile of frontier) {
			const x = tile % world.size;
			const y = (tile - x) / world.size;
			for (const [dx, dy] of NEIGHBOURS$2) {
				const nx = x + dx;
				const ny = y + dy;
				if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
				const at = index(nx, ny, world.size);
				if (seen.has(at)) continue;
				seen.add(at);
				if ((world.layers.road[at] ?? ROAD.none) !== ROAD.none && !isFlooded(world, at)) roads.push(at);
				else next.push(at);
			}
		}
		if (roads.length > 0) return roads;
		frontier = next;
	}
	return [];
}
/** Silniční sousedé dlaždice kromě té, ze které jsme přišli. */
function neighbourRoads(world, tile, from) {
	const x = tile % world.size;
	const y = (tile - x) / world.size;
	const roads = [];
	for (const [dx, dy] of NEIGHBOURS$2) {
		const nx = x + dx;
		const ny = y + dy;
		if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
		const at = index(nx, ny, world.size);
		if (at === from) continue;
		if ((world.layers.road[at] ?? ROAD.none) !== ROAD.none && !isFlooded(world, at)) roads.push(at);
	}
	return roads;
}
//#endregion
//#region src/sim/systems/levels.ts
/**
* Úrovně budov: povýšení, snížení, chátrání a opuštění (§8 zadání fáze 2).
*
* Budova povýší, když je kolem ní dost drahá půda, po její kategorii je
* poptávka a od poslední změny uběhl cooldown. Klesne, když cena půdy spadne
* pod práh její úrovně o víc než hystereze, a to **několikrát po sobě** —
* jednorázový výkyv budovu shazovat nemá.
*
* Chátrání okolím je v ceně půdy samo. Navíc chátrá **věkem, ale jen při
* podfinancování**: stará budova v nedostatečně obsloužené buňce dostane
* penalizaci k efektivní ceně půdy. Plně obsloužená budova nechátrá nikdy.
*
* Vysoká poptávka snižuje oba prahy (`levels.demandRelief`) — město, kam se
* lidé nemají kam nastěhovat, se zahustí ochotněji, a když poptávka opadne,
* zahuštění se zase rozpustí. Posunout jen horní práh nejde: pásmo mezi nimi
* by se převrátilo a budovy by kmitaly nahoru a dolů donekonečna.
*/
var INTERVAL$1 = 20;
/** Offset mimo růst (12/2) i cenu půdy (16/5), ze které systém čte. */
var OFFSET$1 = 9;
function createLevelSystem(catalogue, balance) {
	return {
		name: "levels",
		interval: INTERVAL$1,
		offset: OFFSET$1,
		run(world) {
			const ids = [...world.buildings.keys()].sort((a, b) => a - b);
			const neglect = neglectPenalty(world, balance);
			const present = presentDefinitions(world);
			for (const id of ids) {
				const building = world.buildings.get(id);
				if (!building || building.abandoned) continue;
				const definition = catalogue.get(building.definitionId);
				if (!definition || !isRciCategory(definition.category)) continue;
				if (world.tick - building.levelChangedAtTick < balance.levels.cooldown) continue;
				const cell = coarseIndex(building.x, building.y, world.size);
				const landValue = (world.coarse.landValue[cell] ?? 0) - neglect(building, cell);
				const demand = world.demand[definition.category];
				const relief = Math.max(0, Math.min(demand, balance.demand.limit)) / balance.demand.limit * balance.levels.demandRelief;
				if (landValue < (building.level <= 1 ? 0 : (balance.levels.thresholds[building.level] ?? 0) - balance.levels.hysteresis - relief)) {
					const streak = (world.downgradeStreak.get(id) ?? 0) + 1;
					if (streak < balance.levels.downgradeConfirm) {
						world.downgradeStreak.set(id, streak);
						continue;
					}
					world.downgradeStreak.delete(id);
					tryDowngrade(world, catalogue, building);
					continue;
				}
				world.downgradeStreak.delete(id);
				if (demand <= 0) continue;
				const threshold = balance.levels.thresholds[building.level + 1];
				if (threshold === void 0) continue;
				if (landValue < threshold - relief) continue;
				tryUpgrade(world, catalogue, building, present);
			}
		}
	};
}
/**
* Penalizace za zanedbanost: **stará budova ve špatně obsloužené buňce**.
*
* Obsluhu měříme průměrem přes třídy, které ve městě existují — jedna hasičská
* zbrojnice tak celou čtvrť nezachrání, ale ani město bez jediné školy nezačne
* plošně chátrat kvůli té jedné chybějící třídě.
*
* Kolik penalizace dělá, je věc balancu (`levels.decayPenalty`) — doplněk
* zadání, které výši neurčuje.
*/
function neglectPenalty(world, balance) {
	const coverages = [...world.coverage.values()];
	return (building, cell) => {
		if (world.tick - building.builtAtTick < balance.levels.decayAge) return 0;
		if (coverages.length === 0) return balance.levels.decayPenalty;
		let total = 0;
		for (const coverage of coverages) total += coverage[cell] ?? 0;
		return total / coverages.length < balance.levels.decayCoverageThreshold ? balance.levels.decayPenalty : 0;
	};
}
//#endregion
//#region src/sim/disasters/blackout.ts
/**
* Uklidí po blackoutu.
*
* Volá plánovač při skončení. Bez tohohle by odpojené elektrárny zůstaly
* odpojené navždycky — a hráč by neměl jak to zjistit ani spravit.
*/
function restorePlants(world) {
	if (world.disasters.offlinePlants.size === 0) return;
	world.disasters.offlinePlants.clear();
	world.powerNetworkDirty = true;
}
//#endregion
//#region src/sim/disasters/unrest.ts
/**
* Společné pro stávku, nepokoje a válku gangů (T52).
*
* Všechny tři jsou **stav, ne děj**: nemají dráhu ani epicentrum šíření, mají
* oblast a podmínku, za které skončí. A všechny tři sdílejí jednu myšlenku,
* kvůli které vůbec existují — **hráč je umí zkrátit tím, že zareaguje**.
* Odpočet se každý tik nesnižuje o jedničku, ale o to, jak moc město tlačí
* zpátky. Kdyby to byl pevný čas, nebylo by co hrát: čekalo by se.
*
* Ničivé katastrofy z T51 jsou opak — ty se odehrají a hráč uklízí. Proto mají
* vlastní vrstvu (`damage.ts`) a tyhle vlastní.
*/
/** Průměrná spokojenost v buňkách oblasti, 0–255. Prázdná oblast = celé město. */
function areaHappiness(world, cells) {
	if (cells.length === 0) {
		let sum = 0;
		for (const value of world.happiness) sum += value;
		return world.happiness.length === 0 ? 0 : sum / world.happiness.length;
	}
	let sum = 0;
	let count = 0;
	for (const cell of cells) {
		const value = world.happiness[cell];
		if (value === void 0) continue;
		sum += value;
		count++;
	}
	return count === 0 ? 0 : sum / count;
}
//#endregion
//#region src/sim/disasters/epidemic.ts
/** Uklidí nákazu. Volá plánovač, až epidemie skončí. */
function clearInfection(world) {
	if (world.infection.size === 0) return;
	world.infection.clear();
	world.dirty.coarseChanged = true;
}
//#endregion
//#region src/sim/disasters/fire.ts
/**
* Oheň (§4 fáze 4).
*
* Jediná katastrofa s plnohodnotným šířením, a proto ta, na které stojí
* polovina ostatních — tornádo, zemětřesení, výbuch i nepokoje zakládají
* ohniska právě sem.
*
* Každá hořící dlaždice nese **intenzitu** a **palivo** a je to závod:
*
* ```
* palivo    -= 1
* intenzita += přírůstek
* intenzita -= základ + coverage[fire][buňka] × podíl
*
* intenzita <= 0 → uhašeno, budova přežila
* palivo    <= 0 → zničena, trosky
* ```
*
* Buď hasiči stihnou intenzitu srazit dřív, než dojde palivo, nebo dům shoří.
* Zásah se neprojevuje příjezdem vozu, ale hodnotou `coverage[fire]` — a ta
* u podfinancované stanice klesá (fáze 2 §6), takže hoří déle.
*
* **Silnice, voda, prázdná dlaždice a potrubí nehoří vůbec.** Z toho vzniká
* hlavní aktivní mechanika: hráč prorazí buldozerem průsek a oheň zastaví.
*/
var NEIGHBOURS$1 = [
	[0, -1],
	[1, 0],
	[0, 1],
	[-1, 0]
];
var NOTHING = {
	flammability: 0,
	fuel: 0
};
/**
* Hořlavost dlaždice podle toho, co na ní stojí.
*
* Rozhoduje **obsah, ne konkrétní budova** (P5): kategorie zástavby, ruina,
* les, trosky. Výjimkou jsou třídy služeb v `byClass` — park hoří desetkrát
* hůř než hasičárna, i když obojí je služba, a právě proto se z parku dá
* udělat protipožární bariéra.
*
* Pořadí kontrol je pořadí přebíjení: silnice přebije všechno (průsek musí
* fungovat i skrz les), voda a zaplavená dlaždice taky.
*/
function flammableAt(world, catalogue, balance, tile) {
	const fire = balance.disasters.fire;
	if ((world.layers.road[tile] ?? ROAD.none) !== ROAD.none) return NOTHING;
	if ((world.layers.pipe[tile] ?? 0) !== 0 && (world.layers.buildingId[tile] ?? 0) === 0) return NOTHING;
	const terrain = world.layers.terrain[tile] ?? TERRAIN.grass;
	if (terrain === TERRAIN.water) return NOTHING;
	if ((world.flood?.[tile] ?? 0) > 0) return NOTHING;
	const buildingId = world.layers.buildingId[tile] ?? 0;
	if (buildingId !== 0) {
		const building = world.buildings.get(buildingId);
		if (building) {
			if (building.abandoned) return entry(fire, "abandoned");
			const definition = catalogue.get(building.definitionId);
			const serviceClass = definition?.service?.class;
			if (serviceClass) {
				const override = fire.byClass[serviceClass];
				if (override) return override;
			}
			return entry(fire, definition?.category ?? "service");
		}
	}
	if ((world.rubble[tile] ?? 0) !== 0) return entry(fire, "rubble");
	if (terrain === TERRAIN.forest) return entry(fire, "forest");
	return NOTHING;
}
function entry(fire, key) {
	const flammability = fire.flammability[key];
	const fuel = fire.fuel[key];
	if (flammability === void 0 || fuel === void 0) return NOTHING;
	return {
		flammability,
		fuel
	};
}
/**
* Zapálí dlaždici, pokud je co zapálit. Vrací `true`, když chytla.
*
* Palivo se zapisuje **při zapálení**, ne při každém tiku: kdyby se bralo
* z tabulky průběžně, přestavba budovy uprostřed požáru by mu palivo
* doplnila a hořelo by donekonečna.
*/
function igniteTile(world, catalogue, balance, tile, intensity, wildfire) {
	if ((world.fire[tile] ?? 0) > 0) return false;
	const fuel = flammableAt(world, catalogue, balance, tile);
	if (fuel.flammability <= 0 || fuel.fuel <= 0) return false;
	world.fire[tile] = clampByte(intensity);
	world.fuel[tile] = Math.min(255, fuel.fuel);
	world.fireFlags[tile] = wildfire ? 1 : 0;
	markTileAt(world, tile);
	return true;
}
/** Uhasí dlaždici. Volá to buldozer i konec hoření. */
function extinguishTile(world, tile) {
	if ((world.fire[tile] ?? 0) === 0 && (world.fuel[tile] ?? 0) === 0) return;
	world.fire[tile] = 0;
	world.fuel[tile] = 0;
	world.fireFlags[tile] = 0;
	markTileAt(world, tile);
}
/**
* Ohňový tik. Běží každé dva tiky simulace, **nezávisle na plánovači**.
*
* Hořící dlaždice se procházejí vzestupně podle indexu a náhoda jde z
* `world.rng` — jinak padá determinismus (P2). Pauza pauzuje i požár, protože
* je to obyčejný systém.
*/
function createFireSystem(catalogue, balance) {
	return {
		name: "fire",
		interval: balance.disasters.fire.tickInterval,
		offset: 1,
		run(world) {
			const fire = balance.disasters.fire;
			const layer = world.fire;
			const burning = [];
			for (let tile = 0; tile < layer.length; tile++) if ((layer[tile] ?? 0) > 0) burning.push(tile);
			countBurning(world);
			if (burning.length === 0) return;
			const coverage = world.coverage.get("fire");
			const destroyed = [];
			const ignitions = [];
			for (const tile of burning) {
				const wildfire = (world.fireFlags[tile] ?? 0) === 1;
				const burn = burnSettings(balance, wildfire);
				const cell = cellOf(world, tile);
				const fuelLeft = (world.fuel[tile] ?? 0) - 1;
				world.fuel[tile] = Math.max(0, fuelLeft);
				const suppression = fire.suppressBase + (coverage?.[cell] ?? 0) * fire.suppressPerCoverage;
				const intensity = (layer[tile] ?? 0) + burn.intensityGrowth - suppression;
				world.coarse.pollution[cell] = clampByte((world.coarse.pollution[cell] ?? 0) + fire.pollutionPerTick);
				if (intensity <= 0) {
					extinguishTile(world, tile);
					continue;
				}
				if (fuelLeft <= 0) {
					destroyed.push(tile);
					continue;
				}
				layer[tile] = clampByte(intensity);
				markTileAt(world, tile);
				const x = tile % world.size;
				const y = (tile - x) / world.size;
				for (const [dx, dy] of NEIGHBOURS$1) {
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
					const at = index(nx, ny, world.size);
					if ((layer[at] ?? 0) > 0) continue;
					const target = flammableAt(world, catalogue, balance, at);
					if (target.flammability <= 0) continue;
					const chance = (layer[tile] ?? 0) / 255 * target.flammability * burn.spreadChance;
					if (world.rng.next() < chance) ignitions.push({
						tile: at,
						intensity: burn.ignitionIntensity,
						wildfire
					});
				}
			}
			for (const spot of ignitions) igniteTile(world, catalogue, balance, spot.tile, spot.intensity, spot.wildfire);
			if (destroyed.length > 0) burnDown(world, catalogue, balance, destroyed);
			countBurning(world);
			world.dirty.coarseChanged = true;
		}
	};
}
/**
* Dlaždice, kterým došlo palivo.
*
* Budova mizí **celá**, i když hořel jen její roh: dům s vyhořelým patrem
* není poloviční dům. Zbytek jejího půdorysu se zároveň uhasí, aby po ní
* nezůstal oheň hořící na prázdné parcele.
*/
function burnDown(world, catalogue, balance, tiles) {
	const fire = balance.disasters.fire;
	const doomed = /* @__PURE__ */ new Set();
	let lost = 0;
	for (const tile of tiles) {
		const buildingId = world.layers.buildingId[tile] ?? 0;
		if (buildingId !== 0) {
			doomed.add(buildingId);
			continue;
		}
		extinguishTile(world, tile);
		if (world.layers.terrain[tile] === TERRAIN.forest) {
			world.layers.terrain[tile] = TERRAIN.grass;
			markTerrainChanged(world);
			markTileAt(world, tile);
			continue;
		}
	}
	for (const id of [...doomed].sort((a, b) => a - b)) {
		const building = world.buildings.get(id);
		if (!building) continue;
		const [width, depth] = catalogue.get(building.definitionId)?.footprint ?? [1, 1];
		for (let dy = 0; dy < depth; dy++) for (let dx = 0; dx < width; dx++) {
			const x = building.x + dx;
			const y = building.y + dy;
			if (x >= world.size || y >= world.size) continue;
			const tile = index(x, y, world.size);
			extinguishTile(world, tile);
			spawnRubble(world, tile, building.definitionId);
		}
		if (removeBuilding(world, id)) lost++;
	}
	if (lost > 0 && fire.happinessPerLoss > 0) world.disasters.modifiers.push({
		kind: "happinessPenalty",
		cells: [],
		amount: fire.happinessPerLoss * lost,
		until: world.tick + fire.happinessPenaltyTicks,
		source: 0
	});
}
function burnSettings(balance, wildfire) {
	const kind = wildfire ? "wildfire" : "fire";
	return balance.disasters.types[kind]?.burn ?? FALLBACK_BURN;
}
var FALLBACK_BURN = {
	wildfire: false,
	ignitionIntensity: 100,
	intensityGrowth: 6,
	spreadChance: .5,
	minIgnitions: 1,
	maxIgnitions: 1
};
/**
* Přepočítá, kolik dlaždic hoří kterým způsobem.
*
* Je to **odvozený údaj**, ne stav: po načtení savu se dopočítá z vrstvy
* `fire`. Katastrofy se z něj dozvídají, jestli po nich ještě něco hoří —
* jinak by lesní požár, který se hájí od uhašení, skončil v okamžiku, kdy
* vyskočil první plamen.
*/
function countBurning(world) {
	let normal = 0;
	let wild = 0;
	for (let tile = 0; tile < world.fire.length; tile++) {
		if ((world.fire[tile] ?? 0) === 0) continue;
		if ((world.fireFlags[tile] ?? 0) === 1) wild++;
		else normal++;
	}
	world.disasters.burning = {
		normal,
		wildfire: wild
	};
}
function cellOf(world, tile) {
	const x = tile % world.size;
	return coarseIndex(x, (tile - x) / world.size, world.size);
}
function markTileAt(world, tile) {
	const x = tile % world.size;
	markTileDirty(world, x, (tile - x) / world.size);
}
function clampByte(value) {
	return Math.max(0, Math.min(255, Math.round(value)));
}
//#endregion
//#region src/sim/disasters/riot.ts
/**
* Má neřešená stávka přerůst v nepokoje?
*
* Volá se při skončení stávky. Podmínky jsou tři a všechny musí platit: v
* oblasti klesla spokojenost, kriminalita je nad prahem, a padne hod vážený
* nespokojeností. Doba hájení se ignoruje — tohle není nová katastrofa
* z plánovače, tohle je následek té předchozí.
*/
function escalatesToRiot(world, balance, strike) {
	const riot = balance.disasters.riot;
	const cells = strike.state["cells"] ?? [];
	const happinessNow = areaHappiness(world, cells);
	if (happinessNow >= (strike.state["happinessAtStart"] ?? happinessNow)) {
		world.rng.next();
		return false;
	}
	let crime = 0;
	for (const cell of cells) crime = Math.max(crime, world.coarse.crime[cell] ?? 0);
	if (crime <= riot.escalationCrime) {
		world.rng.next();
		return false;
	}
	const unhappiness = 1 - happinessNow / 255;
	return world.rng.next() < riot.escalationChance * unhappiness;
}
//#endregion
//#region src/sim/disasters/indicators.ts
/**
* Spočítá všechny ukazatele pro daný svět.
*
* Jména jsou dvojího tvaru: prosté (`crime`, `unemployment`) a s třídou služby
* za dvojtečkou (`uncovered:fire`, `underfunded:police`). Třídy jsou obsah —
* mod si přidá vlastní a katalog na ni může vážit, aniž by se sáhlo do kódu.
*/
function computeIndicators(world, catalogue, balance, settings) {
	const values = /* @__PURE__ */ new Map();
	const size = world.size;
	let buildings = 0;
	let abandoned = 0;
	let population = 0;
	let jobs = 0;
	let industrial = 0;
	let dense = 0;
	let old = 0;
	let waterless = 0;
	/** Kolik budov je v které buňce — váha pro průměry vrstev. */
	const perCell = /* @__PURE__ */ new Map();
	for (const building of world.buildings.values()) {
		buildings++;
		if (building.abandoned) {
			abandoned++;
			continue;
		}
		population += building.population;
		jobs += building.jobs;
		const definition = catalogue.get(building.definitionId);
		if (definition?.category === "industrial") industrial++;
		if (building.level >= settings.denseLevel) dense++;
		if (world.tick - building.builtAtTick >= settings.ageTicks) old++;
		if (definition?.construction.requiresWater === true && !world.watered.has(building.id)) waterless++;
		const cell = coarseIndex(building.x, building.y, size);
		perCell.set(cell, (perCell.get(cell) ?? 0) + 1);
	}
	const liveBuildings = Math.max(1, buildings);
	values.set("crime", weightedLayerAverage(world.coarse.crime, perCell));
	values.set("pollution", weightedLayerAverage(world.coarse.pollution, perCell));
	values.set("crimeMax", maxOverInhabited(world.coarse.crime, perCell));
	values.set("industryShare", industrial / liveBuildings);
	values.set("denseShare", dense / liveBuildings);
	values.set("equipmentAge", old / liveBuildings);
	values.set("waterless", waterless / liveBuildings);
	values.set("highLevelShare", industrial === 0 ? 0 : Math.min(1, dense / industrial));
	const rubbleTiles = countRubble(world);
	values.set("neglect", Math.min(1, (abandoned + rubbleTiles) / liveBuildings));
	values.set("neglectIndustry", industrial === 0 ? 0 : Math.min(1, (abandoned + rubbleTiles) / industrial));
	const workers = population * balance.demand.workerRatio;
	values.set("unemployment", workers > 0 ? clamp01((workers - jobs) / workers) : 0);
	values.set("unhappiness", 1 - averageHappiness$1(world) / 255);
	values.set("density", densityOf(perCell));
	const averageRate = (world.economy.taxRates.residential + world.economy.taxRates.commercial + world.economy.taxRates.industrial) / 3;
	const defaultRate = balance.economy.defaultTaxRate;
	values.set("taxBurden", clamp01((averageRate - defaultRate) / Math.max(1, 20 - defaultRate)));
	const congestion = coarseCongestion(world, balance);
	values.set("congestion", clamp01(weightedLayerAverage(congestion, perCell)));
	values.set("majorRoadShare", majorRoadShare(world));
	const power = powerIndicators(world, catalogue);
	values.set("powerReserve", power.reserve);
	values.set("singlePlantShare", power.singlePlantShare);
	return { get(name) {
		const direct = values.get(name);
		if (direct !== void 0) return direct;
		const colon = name.indexOf(":");
		if (colon < 0) return 0;
		const prefix = name.slice(0, colon);
		const serviceClass = name.slice(colon + 1);
		if (prefix === "uncovered") return uncoveredShare(world, serviceClass, perCell, settings.uncoveredBelow);
		if (prefix === "underfunded") return clamp01(1 - (world.serviceFunding.get(serviceClass) ?? 1));
		return 0;
	} };
}
/** Podíl budov v buňkách, kde je pokrytí třídy pod prahem. */
function uncoveredShare(world, serviceClass, perCell, below) {
	const coverage = world.coverage.get(serviceClass);
	if (!coverage) return perCell.size === 0 ? 0 : 1;
	let total = 0;
	let uncovered = 0;
	for (const [cell, count] of perCell) {
		total += count;
		if ((coverage[cell] ?? 0) < below) uncovered += count;
	}
	return total === 0 ? 0 : uncovered / total;
}
/** Průměr vrstvy 0–255 vážený počtem budov, převedený na 0–1. */
function weightedLayerAverage(layer, perCell) {
	let sum = 0;
	let weight = 0;
	for (const [cell, count] of perCell) {
		sum += (layer[cell] ?? 0) * count;
		weight += count;
	}
	if (weight === 0) return 0;
	const average = sum / weight;
	return clamp01(layer instanceof Float32Array ? average / 2 : average / 255);
}
/** Nejhorší obydlená buňka, ne průměr. Válka gangů se rodí v jedné čtvrti. */
function maxOverInhabited(layer, perCell) {
	let worst = 0;
	for (const cell of perCell.keys()) worst = Math.max(worst, layer[cell] ?? 0);
	return clamp01(worst / 255);
}
/**
* Hustota osídlení: obydlené buňky proti všem, které se dají obydlet.
*
* Není to populace na plochu — to by na velké mapě vyšlo skoro nula bez ohledu
* na to, jak hustě se staví. Zajímá nás, jak namačkané je to tam, kde lidé jsou.
*/
function densityOf(perCell) {
	if (perCell.size === 0) return 0;
	let sum = 0;
	for (const count of perCell.values()) sum += count;
	return clamp01(sum / perCell.size / 16);
}
/** Podíl tříd a dálnic na silniční síti. Rychlé silnice znamenají horší nehody. */
function majorRoadShare(world) {
	let major = 0;
	let total = 0;
	for (const tile of world.roadTiles) {
		const type = world.layers.road[tile] ?? ROAD.none;
		if (type === ROAD.none) continue;
		total++;
		if (type >= ROAD.avenue) major++;
	}
	return total === 0 ? 0 : major / total;
}
/** Rezerva sítě a podíl největší elektrárny na výrobě. */
function powerIndicators(world, catalogue) {
	let capacity = 0;
	let biggest = 0;
	let demand = 0;
	for (const building of world.buildings.values()) {
		if (building.abandoned) continue;
		const definition = catalogue.get(building.definitionId);
		if (!definition) continue;
		const output = definition.power?.production ?? 0;
		if (output > 0) {
			capacity += output;
			biggest = Math.max(biggest, output);
		}
		demand += definition.power?.consumption ?? 0;
	}
	if (capacity === 0) return {
		reserve: 0,
		singlePlantShare: demand > 0 ? 1 : 0
	};
	return {
		reserve: clamp01((capacity - demand) / capacity),
		singlePlantShare: clamp01(biggest / capacity)
	};
}
/** Dlaždice trosek. Vrstvu přidává T50; do té doby je jich nula. */
function countRubble(world) {
	const rubble = world.rubble;
	if (!rubble) return 0;
	let count = 0;
	for (let tile = 0; tile < rubble.length; tile++) if ((rubble[tile] ?? 0) !== 0) count++;
	return count;
}
function clamp01(value) {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, Math.min(1, value));
}
/** Terén bez převýšení. Sesuv bez něj nemá kde vzniknout (R22). */
function riskySlopeCount(world) {
	const heights = world.cornerHeight;
	const side = world.size + 1;
	let count = 0;
	for (let y = 0; y < world.size; y++) for (let x = 0; x < world.size; x++) {
		const tile = y * world.size + x;
		if (!((world.layers.buildingId[tile] ?? 0) !== 0 || (world.layers.road[tile] ?? 0) !== 0)) continue;
		if (world.layers.terrain[tile] === TERRAIN.water) continue;
		const nw = heights[y * side + x] ?? 0;
		const ne = heights[y * side + x + 1] ?? 0;
		const sw = heights[(y + 1) * side + x] ?? 0;
		const se = heights[(y + 1) * side + x + 1] ?? 0;
		if (Math.max(nw, ne, sw, se) - Math.min(nw, ne, sw, se) >= 1) count++;
	}
	return count;
}
//#endregion
//#region src/sim/disasters/registry.ts
/**
* Registr katastrof.
*
* Prázdný registr je platný stav: plánovač pak nemá co spustit a hra běží dál.
* Tak to vypadá po T47, který staví jen kostru — jednotlivé pohromy přidávají
* T48 až T54.
*/
var DisasterRegistry = class {
	byKind = /* @__PURE__ */ new Map();
	register(disaster) {
		this.byKind.set(disaster.kind, disaster);
	}
	get(kind) {
		return this.byKind.get(kind);
	}
	/** Setříděné, aby na pořadí registrace nezáleželo — je součástí determinismu. */
	kinds() {
		return [...this.byKind.keys()].sort();
	}
	get size() {
		return this.byKind.size;
	}
};
//#endregion
//#region src/sim/disasters/risk.ts
function computeMetrics(world, catalogue) {
	let buildings = 0;
	let population = 0;
	let industrial = 0;
	let residential = 0;
	let heavy = 0;
	let plants = 0;
	for (const building of world.buildings.values()) {
		if (building.abandoned) continue;
		buildings++;
		population += building.population;
		const definition = catalogue.get(building.definitionId);
		if (!definition) continue;
		if (definition.category === "industrial") {
			industrial++;
			if (building.level >= 3 || (definition.waste?.capacity ?? 0) > 0) heavy++;
		}
		if (definition.category === "residential") residential++;
		if ((definition.power?.production ?? 0) > 0) plants++;
	}
	let coast = 0;
	let forest = 0;
	let flat = 0;
	let land = 0;
	const size = world.size;
	const side = size + 1;
	const heights = world.cornerHeight;
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
		const tile = y * size + x;
		const terrain = world.layers.terrain[tile] ?? TERRAIN.grass;
		if (terrain === TERRAIN.water) continue;
		land++;
		if (terrain === TERRAIN.forest) forest++;
		if (touchesWater(world, x, y)) coast++;
		const nw = heights[y * side + x] ?? 0;
		const ne = heights[y * side + x + 1] ?? 0;
		const sw = heights[(y + 1) * side + x] ?? 0;
		const se = heights[(y + 1) * side + x + 1] ?? 0;
		if (nw === ne && ne === sw && sw === se) flat++;
	}
	return {
		none: 1,
		buildings,
		population,
		roadTiles: world.roadTiles.size,
		coastTiles: coast,
		forestTiles: forest,
		flatShare: land === 0 ? 0 : flat / land,
		industrialBuildings: industrial,
		residentialBuildings: residential,
		heavyIndustry: heavy,
		powerPlants: plants,
		riskySlopes: riskySlopeCount(world)
	};
}
function touchesWater(world, x, y) {
	const size = world.size;
	for (const [dx, dy] of [
		[0, -1],
		[1, 0],
		[0, 1],
		[-1, 0]
	]) {
		const nx = x + dx;
		const ny = y + dy;
		if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
		if (world.layers.terrain[ny * size + nx] === TERRAIN.water) return true;
	}
	return false;
}
/**
* Měřítkový faktor.
*
* Není u všech počet budov: povodeň se škáluje délkou pobřeží, tornádo podílem
* roviny, epidemie populací. Zemětřesení a blackout se neškálují vůbec — velké
* město jimi netrpí častěji, jen hůř.
*/
function scaleFactor(scale, metrics) {
	if (!scale) return 1;
	const raw = metrics[scale.metric] / scale.divisor;
	const shaped = scale.curve === "sqrt" ? Math.sqrt(Math.max(0, raw)) : raw;
	return clamp(scale.offset + shaped, scale.min, scale.max);
}
/**
* Sezónní faktor. Rok má 360 tiků, tedy dvanáct měsíců po třiceti.
*
* Okno se zadává v tikách od začátku roku a smí přesahovat přes Silvestra —
* `from > to` se čte jako „od podzimu do jara".
*/
function seasonFactor(disaster, tick) {
	const season = disaster.season;
	if (!season) return 1;
	const dayOfYear = (tick % 360 + 360) % 360;
	return (season.from <= season.to ? dayOfYear >= season.from && dayOfYear < season.to : dayOfYear >= season.from || dayOfYear < season.to) ? season.inFactor : season.outFactor;
}
/**
* Faktor typu — jediné místo, kde do rizika mluví to, jak hráč město spravuje.
*
* Přírodní katastrofy mají jedničku a je to jejich definice: povodeň nezávisí
* na tom, jak se stará o hasiče, jen na tom, že má město u vody.
*
* `below` u členu znamená „počítej, o kolik ukazatel **chybí** pod hodnotu".
* Používá to rezerva elektrické sítě: nad čtvrtinou rezervy nepřispívá nic,
* pod ní roste strmě. Bez toho by se strmost musela napsat do kódu.
*/
function typeFactor(disaster, indicators, maxMultiplier) {
	if (disaster.natural) return 1;
	let sum = 1;
	for (const term of disaster.risk) sum += termValue(term, indicators);
	return clamp(sum, 1, maxMultiplier);
}
/** Příspěvek jednoho členu k faktoru typu. */
function termValue(term, indicators) {
	const raw = indicators.get(term.indicator);
	return (term.below === void 0 ? raw : Math.max(0, term.below - raw)) * term.weight;
}
/** Kolik téhle katastrofy smí běžet naráz. */
function concurrentLimit(disaster, metrics) {
	const limit = disaster.concurrent;
	if (limit.metric === "none") return limit.min;
	return clamp(Math.floor(metrics[limit.metric] / limit.divisor), limit.min, limit.max);
}
/** Splňuje město podmínky pro vznik? Neplatí pro ruční spuštění z menu. */
function meetsConditions(disaster, metrics) {
	for (const condition of disaster.require) if (metrics[condition.metric] < condition.min) return false;
	return true;
}
/**
* Měsíční pravděpodobnost vzniku, 0–1.
*
* `ceiling` je strop faktoru typu z R16: při záporném rozpočtu se riziko dál
* nezvyšuje, takže se použije to, na čem bylo naposledy v černých číslech.
*/
function monthlyChance(disaster, metrics, indicators, tick, maxMultiplier, ceiling) {
	const factor = Math.min(typeFactor(disaster, indicators, maxMultiplier), ceiling);
	const chance = disaster.baseMonthlyChance * scaleFactor(disaster.scale, metrics) * seasonFactor(disaster, tick) * factor;
	return Math.min(chance, disaster.maxMonthlyChance);
}
function clamp(value, min, max) {
	if (!Number.isFinite(value)) return min;
	return Math.max(min, Math.min(max, value));
}
//#endregion
//#region src/sim/disasters/scheduler.ts
/**
* Plánovač katastrof (§3 fáze 4).
*
* Dvě věci naráz a je to schválně:
*
* - **každý tik** posune běžící katastrofy a nechá vypršet dočasné postihy,
* - **jednou za měsíc** (30 tiků, offset 7) hodí kostkou o nových.
*
* Rozdělit to na dva systémy by znamenalo, že pořadí mezi nimi je další věc,
* na které závisí determinismus. Takhle je jasné, že se nejdřív dohraje to,
* co běží, a teprve pak se losuje nové.
*/
var INTERVAL = 1;
var OFFSET = 0;
/** Jednou za herní měsíc. Proto jsou pravděpodobnosti v katalogu měsíční. */
var ROLL_INTERVAL = 30;
var ROLL_OFFSET = 7;
function createDisasterSystem(catalogue, balance, registry = new DisasterRegistry()) {
	return {
		name: "disasters",
		interval: INTERVAL,
		offset: OFFSET,
		run(world) {
			advanceActive(world, catalogue, balance, registry);
			expireModifiers(world);
			if ((world.tick - ROLL_OFFSET) % ROLL_INTERVAL === 0) rollForNew(world, catalogue, balance, registry);
		}
	};
}
/** Posune běžící katastrofy a uklidí ty, které skončily. */
function advanceActive(world, catalogue, balance, registry) {
	const active = world.disasters.active;
	if (active.length === 0) return;
	/** Stávky, které právě skončily. Eskaluje se až po úklidu seznamu. */
	const escalating = [];
	for (const entry of active) {
		if (entry.finished) continue;
		const disaster = registry.get(entry.kind);
		if (!disaster) {
			entry.finished = true;
			continue;
		}
		disaster.tick(contextFor(world, catalogue, balance, entry.x, entry.y), entry);
		if (disaster.isFinished(world, entry)) entry.finished = true;
	}
	let write = 0;
	for (let read = 0; read < active.length; read++) {
		const entry = active[read];
		if (!entry) continue;
		if (!entry.finished) {
			active[write++] = entry;
			continue;
		}
		clearModifiersOf(world, entry.id);
		if (entry.kind === "blackout") restorePlants(world);
		if (entry.kind === "epidemic") clearInfection(world);
		if (registry.get(entry.kind)?.cooldownFromEnd) world.disasters.lastOccurrence.set(entry.kind, world.tick);
		if (entry.kind === "strike" && registry.get("riot")) escalating.push(entry);
	}
	active.length = write;
	for (const strike of escalating) {
		if (!escalatesToRiot(world, balance, strike)) continue;
		startDisaster(world, catalogue, balance, registry, "riot", strike.x, strike.y);
	}
}
/**
* Měsíční hod o nových katastrofách.
*
* Pořadí typů je **setříděné**, ne pořadí registrace: každý hod posune `rng`,
* takže by jinak stačilo přeskládat importy a ze stejného seedu by vyšlo jiné
* město (P2).
*/
function rollForNew(world, catalogue, balance, registry) {
	if (!world.disasters.enabled) return;
	if (registry.size === 0) return;
	const metrics = computeMetrics(world, catalogue);
	const indicators = computeIndicators(world, catalogue, balance, balance.disasters.indicators);
	const solvent = world.economy.lastIncome - world.economy.lastExpenses >= 0;
	for (const kind of registry.kinds()) {
		const disaster = registry.get(kind);
		const settings = balance.disasters.types[kind];
		if (!disaster || !settings) continue;
		const last = world.disasters.lastOccurrence.get(kind);
		if (last !== void 0 && world.tick - last < settings.cooldownTicks) continue;
		if (world.disasters.active.filter((entry) => entry.kind === kind).length >= concurrentLimit(settings, metrics)) continue;
		if (!meetsConditions(settings, metrics)) continue;
		const raw = typeFactor(settings, indicators, balance.disasters.maxRiskMultiplier);
		if (solvent) world.disasters.riskCeiling.set(kind, raw);
		const ceiling = solvent ? raw : world.disasters.riskCeiling.get(kind) ?? balance.disasters.maxRiskMultiplier;
		const chance = monthlyChance(settings, metrics, indicators, world.tick, balance.disasters.maxRiskMultiplier, ceiling);
		if (world.rng.next() >= chance) continue;
		const origin = disaster.pickOrigin(world, catalogue, balance);
		if (!origin) continue;
		startDisaster(world, catalogue, balance, registry, kind, origin.x, origin.y);
	}
}
/**
* Spustí katastrofu na daném místě.
*
* Vystaveno kvůli **menu katastrof**: to nepodléhá ani hájení, ani přepínači
* z R18 (§6 fáze 4). Je to zároveň jediný rozumný způsob, jak je ladit.
*/
function startDisaster(world, catalogue, balance, registry, kind, x, y) {
	const disaster = registry.get(kind);
	if (!disaster) return null;
	const entry = {
		id: world.disasters.nextId++,
		kind,
		startedAtTick: world.tick,
		x,
		y,
		state: {},
		finished: false
	};
	world.disasters.active.push(entry);
	if (!disaster.cooldownFromEnd) world.disasters.lastOccurrence.set(kind, world.tick);
	disaster.start(contextFor(world, catalogue, balance, x, y), entry);
	if (disaster.isFinished(world, entry)) entry.finished = true;
	return entry;
}
function contextFor(world, catalogue, balance, x, y) {
	return {
		world,
		catalogue,
		balance,
		x,
		y
	};
}
//#endregion
//#region src/sim/systems/transit.ts
/**
* Udržuje odvozený stav linek (§7 fáze 4).
*
* Zatím jediná odvozená věc jsou **koleje ve vozovce**: které silnice ukusuje
* tramvaj a o kolik. Přepočítává se jen při změně, stejně jako elektřina nebo
* pokrytí — trasa se mění, když hráč sáhne na linku, ne každý tik.
*
* Běží **před dopravou**: kolony si z toho čtou zbylou kapacitu, a kdyby se
* přepočet stihl až po nich, hráč by o změně věděl až za osm tiků.
*
* Zbouraná zastávka linku nemění sama od sebe, ale koridor ano — proto se
* značka nastavuje i při bourání budov.
*/
/** Jednou za herní měsíc, o tik dřív než rozpočet — ten si z toho čte. */
var STATS_INTERVAL = 30;
var STATS_OFFSET = 29;
function createTransitSystem(catalogue, balance) {
	return {
		name: "transit",
		interval: 1,
		offset: 0,
		run(world) {
			if (world.transitDirty) rebuildTramTiles(world, catalogue, balance);
			if ((world.tick - STATS_OFFSET) % STATS_INTERVAL === 0) computeLineStats(world, catalogue, balance);
		}
	};
}
//#endregion
//#region src/sim/systems/finance.ts
/**
* Splátky a granty (§8 fáze 4).
*
* **Granty se zkoumají každý tik**, protože podmínka „spokojenost nad prahem
* po celý rok" se počítá v tikách a přerušení ji musí zrušit hned. Je to
* levné: pár definic a jedno porovnání na každou.
*
* **Splátky jednou za měsíc**, hned za rozpočtem — město má nejdřív vybrat
* daně a pak platit. Opačné pořadí by znamenalo, že se splátka strhne z kasy
* před příjmem a hráč by přišel o měsíc, který mu vyšel.
*/
var MONTH = 30;
/** Za `economySystem` (offset 0), aby se splácelo z už vybraných daní. */
var PAY_OFFSET = 1;
function createFinanceSystem(catalogue, balance, grants) {
	return {
		name: "finance",
		interval: 1,
		offset: 0,
		run(world) {
			awardGrants(world, catalogue, grants);
			if ((world.tick - PAY_OFFSET) % MONTH !== 0) return;
			payLoans(world, balance);
			serviceBonds(world, balance);
			rememberPopulation(world);
		}
	};
}
//#endregion
//#region src/sim/systems/index.ts
/**
* Rozvrstvení podle architektury §5 — drahé systémy nesmí spadnout do stejného
* tiku, proto interval + fázový offset.
*/
function shouldRun(tick, interval, offset) {
	return (tick - offset) % interval === 0;
}
/**
* Pořadí registrace je pořadí vyhodnocení v rámci tiku a je součástí
* determinismu — přeházení změní golden hashe.
*
* Všechny systémy potřebují obsah, takže je registr funkce, ne konstanta.
* Systém si katalog uzavře do closure a `run(world)` zůstává beze změny.
*/
function createDefaultSystems(catalogue, balance, disasters = new DisasterRegistry(), grants = []) {
	return [
		createDisasterSystem(catalogue, balance, disasters),
		createFireSystem(catalogue, balance),
		createFloodSystem(catalogue, balance),
		createPowerSystem(catalogue),
		createWaterSystem(catalogue, balance),
		createServiceSystem(catalogue),
		createDemandSystem(catalogue, balance),
		createGrowthSystem(catalogue, balance),
		createLevelSystem(catalogue, balance),
		createEconomySystem(catalogue, balance),
		createFinanceSystem(catalogue, balance, grants),
		createTransitSystem(catalogue, balance),
		createTrafficSystem(catalogue, balance),
		createPollutionSystem(catalogue, balance),
		createCrimeSystem(balance),
		createHealthSystem(catalogue, balance),
		createWaterDecaySystem(catalogue, balance),
		createLandValueSystem(balance),
		createHappinessSystem(balance)
	];
}
var STARTING_FUNDS = 2e4;
/**
* Nový svět o hraně `size`.
*
* Velikost je parametr, ne konstanta (T42): mapy 128–512 se liší jen tímhle
* číslem a všechno ostatní — vrstvy, hrubá mřížka, rohy terénu — se z něj
* odvodí. Výchozí hodnota je tu kvůli testům, hra ji vždycky předává z dialogu
* nové hry.
*/
function createWorld(seed, economy = {
	startingFunds: STARTING_FUNDS,
	defaultTaxRate: 7
}, size = 128) {
	const coarseCells = coarseCellsOf(size);
	return {
		size,
		seed: seed >>> 0,
		tick: 0,
		layers: createLayers(size),
		coarse: createCoarseLayers(size),
		buildings: /* @__PURE__ */ new Map(),
		nextBuildingId: 1,
		economy: {
			funds: economy.startingFunds,
			taxRates: {
				residential: economy.defaultTaxRate,
				commercial: economy.defaultTaxRate,
				industrial: economy.defaultTaxRate
			},
			creditRating: 1,
			lastPopulation: 0,
			lastIncome: 0,
			lastExpenses: 0
		},
		demand: {
			residential: 0,
			commercial: 0,
			industrial: 0
		},
		rng: new Rng(seed),
		dirty: {
			tiles: /* @__PURE__ */ new Set(),
			buildings: /* @__PURE__ */ new Set(),
			fullRedraw: true,
			coarseChanged: true
		},
		coverage: /* @__PURE__ */ new Map(),
		serviceFunding: /* @__PURE__ */ new Map(),
		coverageDirty: false,
		trafficLoad: new Float32Array(size * size),
		cornerHeight: createCornerHeights(size),
		jobAccess: /* @__PURE__ */ new Map(),
		jobAccessCells: new Float32Array(coarseCells).fill(1),
		cityJobAccess: 1,
		trafficCursor: 0,
		map: {
			seed: seed >>> 0,
			generated: false
		},
		downgradeStreak: /* @__PURE__ */ new Map(),
		powerNetworkDirty: false,
		waterSupply: new Uint8Array(size * size),
		watered: /* @__PURE__ */ new Set(),
		waterlessStreak: /* @__PURE__ */ new Map(),
		waterNetworkDirty: false,
		happiness: new Uint8Array(coarseCells).fill(128),
		roadTiles: /* @__PURE__ */ new Set(),
		zonedTiles: /* @__PURE__ */ new Set(),
		waterNear: null,
		terrainShares: /* @__PURE__ */ new Map(),
		disasters: createDisasterState(),
		fire: new Uint8Array(size * size),
		fuel: new Uint8Array(size * size),
		fireFlags: new Uint8Array(size * size),
		rubble: new Uint8Array(size * size),
		rubbleOf: /* @__PURE__ */ new Map(),
		terraformTick: new Uint16Array(size * size),
		infection: /* @__PURE__ */ new Map(),
		lines: [],
		nextLineId: 1,
		tramTiles: /* @__PURE__ */ new Map(),
		transitDirty: false,
		lineStats: /* @__PURE__ */ new Map(),
		loans: [],
		nextLoanId: 1,
		grantsAwarded: /* @__PURE__ */ new Set(),
		grantProgress: /* @__PURE__ */ new Map(),
		bonds: [],
		nextBondId: 1,
		bondsBlockedUntil: 0,
		transitRelief: /* @__PURE__ */ new Map(),
		flood: new Uint8Array(size * size),
		floodDepth: new Uint8Array(size * size),
		floodDamage: new Uint8Array(size * size)
	};
}
/**
* Zapíše silnici a udrží seznam. **Jediná cesta, jak do vrstvy `road` psát.**
*
* Kdyby někdo zapsal do vrstvy přímo, seznam by se rozešel s mapou a růst by
* si vymýšlel silnice, které nikdo nepostavil. Hlídá to test, který po dlouhém
* běhu seznam přepočítá a porovná.
*/
function setRoadTile(world, tile, type) {
	world.layers.road[tile] = type;
	if (type === 0) world.roadTiles.delete(tile);
	else world.roadTiles.add(tile);
}
/** Zapíše zónu a udrží seznam. Stejný důvod jako u `setRoadTile`. */
function setZoneTile(world, tile, zone) {
	world.layers.zone[tile] = zone;
	if (zone === 0) world.zonedTiles.delete(tile);
	else world.zonedTiles.add(tile);
}
/** Terén se změnil — co se z něj počítá, se musí zahodit. */
function markTerrainChanged(world) {
	world.waterNear = null;
	world.terrainShares.clear();
}
/**
* Postaví seznamy znovu průchodem vrstev.
*
* Používá to načtení savu — seznamy se neukládají (R10), protože odvozený stav
* v savu se dřív nebo později rozejde se skutečností. A používají to testy jako
* orákulum: co vyjde odsud, musí sedět s tím, co se udržovalo cestou.
*/
function rebuildTileIndex(world) {
	world.roadTiles.clear();
	world.zonedTiles.clear();
	world.waterNear = null;
	world.terrainShares.clear();
	const { road, zone } = world.layers;
	for (let tile = 0; tile < road.length; tile++) {
		if ((road[tile] ?? 0) !== 0) world.roadTiles.add(tile);
		if ((zone[tile] ?? 0) !== 0) world.zonedTiles.add(tile);
	}
}
/** Potrubí nebo vodárna se změnily — vodovod se musí přepočítat. */
function markWaterNetworkDirty(world) {
	world.waterNetworkDirty = true;
}
/** Vodiče (silnice, budovy) se změnily — síť se musí přepočítat. */
function markPowerNetworkDirty(world) {
	world.powerNetworkDirty = true;
}
/** Přibyla nebo zmizela služba, případně se změnilo financování. */
function markCoverageDirty(world) {
	world.coverageDirty = true;
}
/** Dlaždice, které se dotýkají rohu. Roh drží čtyři, u kraje mapy míň. */
function tilesAroundCorner(world, corner) {
	const cornerSize = world.size + 1;
	const cx = corner % cornerSize;
	const cy = (corner - cx) / cornerSize;
	const tiles = [];
	for (const [dx, dy] of [
		[-1, -1],
		[0, -1],
		[-1, 0],
		[0, 0]
	]) {
		const x = cx + dx;
		const y = cy + dy;
		if (inBounds(x, y, world.size)) tiles.push(index(x, y, world.size));
	}
	return tiles;
}
/**
* Smí se terén na tomhle plánu vůbec hnout? Vrací jméno překážky, jinak `null`.
*
* Roh drží čtyři dlaždice, takže srovnání pod jednou budovou hne i terénem pod
* sousedy. Kdyby na některém stála stavba, spadla by do svahu, aniž by o to
* kdokoli řekl — a **hladinu moře zvedat neumíme** vůbec.
*
* Bydlí to ve `world.ts`, protože se na to ptají dvě různá místa: hráčův příkaz
* a růst zástavby. Dvě kopie téhož pravidla by se rozešly.
*/
function reshapeBlocker(world, changes) {
	for (const [corner, target] of changes) {
		const current = world.cornerHeight[corner] ?? 0;
		for (const tile of tilesAroundCorner(world, corner)) {
			if (world.layers.buildingId[tile] !== 0) return "building";
			if (target > current && world.layers.terrain[tile] === TERRAIN.water) return "water";
		}
	}
	return null;
}
function applyHeightChanges(world, changes) {
	const cornerSize = world.size + 1;
	for (const [corner, height] of changes) {
		world.cornerHeight[corner] = height;
		const cx = corner % cornerSize;
		const cy = (corner - cx) / cornerSize;
		for (const [dx, dy] of [
			[-1, -1],
			[0, -1],
			[-1, 0],
			[0, 0]
		]) {
			const x = cx + dx;
			const y = cy + dy;
			if (!inBounds(x, y, world.size)) continue;
			const tile = index(x, y, world.size);
			world.dirty.tiles.add(tile);
			world.terraformTick[tile] = world.tick & 65535;
			const buildingId = world.layers.buildingId[tile] ?? 0;
			if (buildingId !== 0) world.dirty.buildings.add(buildingId);
		}
	}
}
/** Financování třídy v rozsahu 0–1. Neznámá třída je plně financovaná. */
function serviceFunding(world, serviceClass) {
	return world.serviceFunding.get(serviceClass) ?? 1;
}
function coverageOf(world, serviceClass) {
	return world.coverage.get(serviceClass);
}
function markTileDirty(world, x, y) {
	if (inBounds(x, y, world.size)) world.dirty.tiles.add(index(x, y, world.size));
}
function markBuildingDirty(world, buildingId) {
	world.dirty.buildings.add(buildingId);
}
/**
* Odstraní budovu i její otisk ve vrstvě `buildingId`.
*
* Footprint se hledá průchodem celou vrstvou, protože entita svou velikost
* nenese (architektura §4) a bez definice ji nelze odvodit. Bourání je akce
* hráče, ne věc tiku, takže 16 384 porovnání nikoho nebolí.
*/
function removeBuilding(world, buildingId) {
	if (!world.buildings.delete(buildingId)) return false;
	world.downgradeStreak.delete(buildingId);
	world.jobAccess.delete(buildingId);
	const layer = world.layers.buildingId;
	for (let tile = 0; tile < layer.length; tile++) {
		if (layer[tile] !== buildingId) continue;
		layer[tile] = 0;
		const x = tile % world.size;
		markTileDirty(world, x, (tile - x) / world.size);
	}
	markBuildingDirty(world, buildingId);
	markPowerNetworkDirty(world);
	markWaterNetworkDirty(world);
	world.watered.delete(buildingId);
	world.waterlessStreak.delete(buildingId);
	markCoverageDirty(world);
	return true;
}
/**
* Populace je agregát přes budovy — obyvatelé nejsou entity (§4).
*
* Bere rovnou mapu budov, aby funkce fungovala i nad `ReadonlyWorldView`,
* ze kterého čte UI.
*/
function totalPopulation(buildings) {
	let total = 0;
	for (const building of buildings.values()) total += building.population;
	return total;
}
/**
* Jeden herní den. `tick` se zvyšuje jako první, takže systémy vidí číslo tiku,
* který právě probíhá, a po N voláních platí `world.tick === N`.
*/
function tickWorld(world, systems) {
	world.tick += 1;
	for (const system of systems) if (shouldRun(world.tick, system.interval, system.offset)) system.run(world);
}
//#endregion
//#region src/save/format.ts
/** Musí odpovídat `version` v package.json; hlídá to test. */
var GAME_VERSION = "0.1.0";
/**
* Pořadí vrstev v `layers.bin`. **Je součástí `formatVersion`** — přeházení
* nebo doplnění vrstvy je nová verze plus migrace.
*
* Schválně je to vlastní seznam, ne `LAYER_ORDER` ze `sim/layers.ts`: ten slouží
* k hashování a kdyby se změnil, savy by se rozbily potichu.
*/
var SAVE_LAYER_ORDER = [
	"terrain",
	"zone",
	"road",
	"buildingId",
	"power",
	"pipe"
];
/**
* Pořadí hrubých vrstev v `coarse.bin` (verze 2). Vlastní seznam ze stejného
* důvodu jako `SAVE_LAYER_ORDER` — kdyby se vzalo pořadí z `sim/coarse.ts`,
* jeho změna by savy rozbila potichu.
*/
var SAVE_COARSE_LAYER_ORDER = [
	"pollution",
	"landValue",
	"crime"
];
/**
* Pořadí vrstev katastrof v `disasters.bin` (verze 6).
*
* Vlastní soubor, ne přílepek k `layers.bin`: sedm vrstev, které umí být celé
* nulové po celou hru. Kdyby se přilepily doprostřed stávajícího bufferu,
* musel by se při každé změně přeskládat — a hlavně by se rozbila migrace,
* která dnes jen připisuje bajty na konec.
*
* **Ukládá se i probíhající pohroma** (rozhodnutí autora). Bez toho by si hráč
* uložil, nechal město shořet a načetl zpátky.
*/
var SAVE_DISASTER_LAYER_ORDER = [
	"fire",
	"fuel",
	"fireFlags",
	"flood",
	"floodDepth",
	"floodDamage",
	"rubble"
];
var SAVE_FILES = {
	meta: "meta.json",
	layers: "layers.bin",
	/** Hrubé vrstvy, od verze 2. */
	coarse: "coarse.bin",
	/**
	* Patra v rozích, od verze 4. Vlastní soubor, ne přílepek k `layers.bin`:
	* mřížka rohů je o jedna větší než mřížka dlaždic, takže míchat je do
	* jednoho bufferu by znamenalo číst bajty podle toho, co je zrovna v kódu.
	*/
	heights: "heights.bin",
	entities: "entities.json",
	state: "state.json",
	/** Vrstvy ohně, povodně a trosek, od verze 6. */
	disasters: "disasters.bin",
	/**
	* Tik poslední terénní úpravy dlaždice, od verze 8. Vlastní soubor ze
	* stejného důvodu jako `heights.bin`: je **dvoubajtový**, kdežto vrstvy
	* v `disasters.bin` jsou po jednom, a míchat je do jednoho bufferu by
	* znamenalo číst bajty podle toho, co je zrovna v kódu.
	*/
	terraform: "terraform.bin"
};
//#endregion
//#region src/save/serialize.ts
/**
* Vrstvy do jednoho bufferu, každá hodnota **explicitně little-endian**.
*
* Zápis přes `DataView` místo pohledu na buffer typed array je záměr: pohled by
* převzal endianitu stroje a save z ARMu by se na jiné mašině načetl jako šum.
*/
function packLayers(layers) {
	let byteLength = 0;
	for (const name of SAVE_LAYER_ORDER) byteLength += layers[name].length * layers[name].BYTES_PER_ELEMENT;
	const buffer = new ArrayBuffer(byteLength);
	const view = new DataView(buffer);
	let offset = 0;
	for (const name of SAVE_LAYER_ORDER) {
		const layer = layers[name];
		if (layer.BYTES_PER_ELEMENT === 1) for (const value of layer) {
			view.setUint8(offset, value);
			offset += 1;
		}
		else for (const value of layer) {
			view.setUint16(offset, value, true);
			offset += 2;
		}
	}
	return new Uint8Array(buffer);
}
/**
* Hrubé vrstvy do jednoho bufferu. Všechny jsou jednobajtové, takže endianita
* nehraje roli — kdyby některá přestala být, je to nová verze formátu.
*/
function packCoarseLayers(coarse) {
	const cells = coarse.pollution.length;
	const buffer = new Uint8Array(cells * SAVE_COARSE_LAYER_ORDER.length);
	let offset = 0;
	for (const name of SAVE_COARSE_LAYER_ORDER) {
		buffer.set(coarse[name], offset);
		offset += cells;
	}
	return buffer;
}
/**
* Vrstvy katastrof do jednoho bufferu (verze 6).
*
* Všech sedm je jednobajtových. Ukládají se **vždycky**, i když je město celé
* nedotčené — prázdný buffer se v ZIPu smrskne skoro na nic a podmíněný soubor
* by znamenal, že se save čte jinak podle toho, co se ve městě zrovna dělo.
*/
/**
* Tiky terénních úprav do bajtů, **little-endian**.
*
* Pořadí bajtů se píše ručně a ne přes `new Uint8Array(buffer)`, protože to
* druhé závisí na endianitě stroje — save uložený na jednom by se na druhém
* četl obráceně.
*/
function packTerraform(world) {
	const cells = world.size * world.size;
	const bytes = new Uint8Array(cells * 2);
	for (let tile = 0; tile < cells; tile++) {
		const value = world.terraformTick[tile] ?? 0;
		bytes[tile * 2] = value & 255;
		bytes[tile * 2 + 1] = value >> 8 & 255;
	}
	return bytes;
}
function packDisasterLayers(world) {
	const cells = world.size * world.size;
	const buffer = new Uint8Array(cells * SAVE_DISASTER_LAYER_ORDER.length);
	let offset = 0;
	for (const name of SAVE_DISASTER_LAYER_ORDER) {
		buffer.set(world[name], offset);
		offset += cells;
	}
	return buffer;
}
/** Katastrofy do savu. Odvozené se vynechává — dopočítá se po načtení. */
function packDisasters(world) {
	const state = world.disasters;
	return {
		enabled: state.enabled,
		lastOccurrence: sortedRecord(state.lastOccurrence),
		active: state.active.map((entry) => ({
			id: entry.id,
			kind: entry.kind,
			startedAtTick: entry.startedAtTick,
			x: entry.x,
			y: entry.y,
			state: { ...entry.state },
			finished: entry.finished
		})),
		modifiers: state.modifiers.map((modifier) => ({
			kind: modifier.kind,
			...modifier.serviceClass !== void 0 ? { serviceClass: modifier.serviceClass } : {},
			cells: [...modifier.cells],
			amount: modifier.amount,
			until: modifier.until,
			source: modifier.source
		})),
		nextId: state.nextId,
		riskCeiling: sortedRecord(state.riskCeiling),
		offlinePlants: [...state.offlinePlants].sort((a, b) => a - b),
		infection: [...world.infection.entries()].sort(([a], [b]) => a - b),
		rubbleOf: [...world.rubbleOf.entries()].sort(([a], [b]) => a - b)
	};
}
function packTransit(world) {
	return {
		lines: [...world.lines].sort((a, b) => a.id - b.id).map((line) => ({
			id: line.id,
			mode: line.mode,
			stops: [...line.stops],
			vehicles: line.vehicles,
			fare: line.fare
		})),
		nextLineId: world.nextLineId
	};
}
function packFinance(world) {
	return {
		loans: [...world.loans].sort((a, b) => a.id - b.id).map((loan) => ({ ...loan })),
		nextLoanId: world.nextLoanId,
		bonds: [...world.bonds].sort((a, b) => a.id - b.id).map((bond) => ({ ...bond })),
		nextBondId: world.nextBondId,
		bondsBlockedUntil: world.bondsBlockedUntil,
		grantsAwarded: [...world.grantsAwarded].sort(),
		grantProgress: [...world.grantProgress.entries()].sort(([a], [b]) => a.localeCompare(b))
	};
}
/** Mapa na objekt se setříděnými klíči — save musí být bajtově stabilní. */
function sortedRecord(map) {
	return Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
}
function toSaveData(world, options) {
	return {
		meta: {
			formatVersion: 8,
			gameVersion: GAME_VERSION,
			city: {
				name: options.cityName,
				seed: world.seed
			},
			createdAt: options.createdAt,
			modifiedAt: options.modifiedAt,
			playtimeSeconds: options.playtimeSeconds,
			content: { sources: options.sources.map(({ id, version }) => ({
				id,
				version
			})) },
			grid: {
				size: world.size,
				coarseSize: coarseSizeOf(world.size)
			},
			map: { ...world.map },
			preview: {
				population: totalPopulation(world.buildings),
				funds: world.economy.funds,
				tick: world.tick
			}
		},
		layers: packLayers(world.layers),
		coarse: packCoarseLayers(world.coarse),
		heights: Uint8Array.from(world.cornerHeight),
		terraform: packTerraform(world),
		disasters: packDisasterLayers(world),
		entities: {
			nextBuildingId: world.nextBuildingId,
			buildings: [...world.buildings.values()].sort((a, b) => a.id - b.id).map((building) => ({ ...building }))
		},
		state: {
			tick: world.tick,
			rngState: world.rng.getState(),
			economy: {
				...world.economy,
				taxRates: { ...world.economy.taxRates }
			},
			demand: { ...world.demand },
			trafficCursor: world.trafficCursor,
			serviceFunding: Object.fromEntries([...world.serviceFunding.entries()].sort(([a], [b]) => a.localeCompare(b))),
			disasters: packDisasters(world),
			transit: packTransit(world),
			finance: packFinance(world)
		}
	};
}
/**
* Zabalí save do skutečného ZIPu.
*
* `meta.json` se ukládá **nekomprimovaně** (`level: 0`), aby se dal přečíst bez
* dekomprese zbytku — seznam uložených her se tím vykreslí okamžitě (§8).
*
* Čas v hlavičkách položek je `meta.modifiedAt`, ne systémový čas. ZIP si ho
* ukládá u každého souboru, takže bez toho by dva savy téhož města vyšly
* pokaždé jinak — a fixtura by se nedala vygenerovat znovu a porovnat s tou
* v repozitáři. Vyplavalo to při psaní fixtury v5 (T40).
*/
function packSave(save) {
	const mtime = save.meta.modifiedAt;
	return zipSync({
		[SAVE_FILES.meta]: [strToU8(JSON.stringify(save.meta, null, 2)), {
			level: 0,
			mtime
		}],
		[SAVE_FILES.layers]: [save.layers, {
			level: 9,
			mtime
		}],
		[SAVE_FILES.coarse]: [save.coarse, {
			level: 9,
			mtime
		}],
		[SAVE_FILES.heights]: [save.heights, {
			level: 9,
			mtime
		}],
		[SAVE_FILES.disasters]: [save.disasters, {
			level: 9,
			mtime
		}],
		[SAVE_FILES.terraform]: [save.terraform, {
			level: 9,
			mtime
		}],
		[SAVE_FILES.entities]: [strToU8(JSON.stringify(save.entities)), {
			level: 9,
			mtime
		}],
		[SAVE_FILES.state]: [strToU8(JSON.stringify(save.state)), {
			level: 9,
			mtime
		}]
	});
}
function serializeSave(world, options) {
	return packSave(toSaveData(world, options));
}
function roadMask(isRoad, x, y) {
	let mask = 0;
	if (isRoad(x, y - 1)) mask |= 1;
	if (isRoad(x + 1, y)) mask |= 2;
	if (isRoad(x, y + 1)) mask |= 4;
	if (isRoad(x - 1, y)) mask |= 8;
	return mask;
}
/**
* Srovnání příčného spádu pro nově stavěnou dlaždici **i pro její sousedy**.
*
* Sousedy to musí přepočítat taky: rovné silnici, ke které přibude odbočka,
* se změní maska, z přímého úseku se stane zatáčka — a ta se musí srovnat celá.
* Bez toho by se šejdrem vozovka objevila přesně na křižovatkách, tedy tam,
* kde je nejvíc vidět.
*
* Počítá se na pracovní kopii, aby druhý soused viděl, co udělal první.
* Vrací jen rohy, které se opravdu mění.
*/
function planRoadGradeAround(world, x, y) {
	const built = (nx, ny) => nx === x && ny === y || inBounds(nx, ny, world.size) && (world.layers.road[index(nx, ny, world.size)] ?? ROAD.none) !== ROAD.none;
	const working = Uint8Array.from(world.cornerHeight);
	const changes = /* @__PURE__ */ new Map();
	const tiles = [[x, y]];
	for (const [dx, dy] of [
		[0, -1],
		[1, 0],
		[0, 1],
		[-1, 0]
	]) if (built(x + dx, y + dy) && inBounds(x + dx, y + dy, world.size)) tiles.push([x + dx, y + dy]);
	for (const [tx, ty] of tiles) {
		const step = planRoadGrade(working, tx, ty, roadMask(built, tx, ty));
		applyCornerChanges(working, step);
		for (const [k, v] of step) changes.set(k, v);
	}
	for (const [k, v] of [...changes]) if ((world.cornerHeight[k] ?? 0) === v) changes.delete(k);
	return changes;
}
//#endregion
//#region src/sim/commands.ts
/** Má dlaždice aspoň jednoho silničního souseda? Odsud se staví mosty dál. */
function touchesRoad(world, x, y) {
	for (const [dx, dy] of [
		[0, -1],
		[1, 0],
		[0, 1],
		[-1, 0]
	]) {
		if (!inBounds(x + dx, y + dy, world.size)) continue;
		if ((world.layers.road[index(x + dx, y + dy, world.size)] ?? ROAD.none) !== ROAD.none) return true;
	}
	return false;
}
/**
* Změna silnice mění auto-tiling i u čtyř sousedů, takže do `DirtySet` musí
* i oni — jinak by zůstali vykreslení se starým napojením.
*/
function markRoadNeighbourhoodDirty(world, x, y) {
	markTileDirty(world, x, y);
	markTileDirty(world, x, y - 1);
	markTileDirty(world, x + 1, y);
	markTileDirty(world, x, y + 1);
	markTileDirty(world, x - 1, y);
}
/**
* Validace patří sem, ne do UI (architektura §5) — jinak by ji obcházel každý
* další vstup, který kdy vznikne.
*/
function buildRoad(world, x, y, type = ROAD.street, balance) {
	if (!inBounds(x, y, world.size)) return reject("error.outOfBounds");
	const tile = index(x, y, world.size);
	if (world.layers.buildingId[tile] !== 0) return reject("error.occupied");
	if ((world.rubble[tile] ?? 0) !== 0) return reject("error.rubbleInTheWay");
	const overWater = world.layers.terrain[tile] === TERRAIN.water;
	if (overWater && !touchesRoad(world, x, y)) return reject("error.bridgeNeedsBank");
	const terrain = world.layers.terrain[tile] ?? TERRAIN.grass;
	const clearing = !overWater && needsClearing(terrain) ? clearingCost(balance, terrain) : 0;
	let grade = null;
	if (!overWater) {
		grade = planRoadGradeAround(world, x, y);
		if (reshapeBlocker(world, grade) === "water") return reject("error.terraformWater");
	}
	const current = world.layers.road[tile] ?? ROAD.none;
	if (current === type) return reject("error.roadExists");
	if (current > type) return reject("error.roadDowngrade");
	const levelling = (grade?.size ?? 0) * (balance?.map.terraformCost ?? 0);
	const cost = (overWater ? balance?.traffic.bridgeCost ?? 0 : balance?.traffic.roadTypes[type - 1]?.cost ?? 0) + clearing + levelling;
	if (world.economy.funds < cost) return reject("error.notEnoughFunds", {
		cost,
		funds: world.economy.funds
	});
	world.economy.funds -= cost;
	if (grade && grade.size > 0) applyHeightChanges(world, grade);
	if (clearing > 0) {
		world.layers.terrain[tile] = TERRAIN.grass;
		markTerrainChanged(world);
	}
	setRoadTile(world, tile, type);
	markRoadNeighbourhoodDirty(world, x, y);
	markPowerNetworkDirty(world);
	return OK;
}
/**
* Co stojí vyklizení dlaždice. Sazba je v datech podle terénu (P5) — vykácet
* les je levnější než odtěžit skálu a hráč to má poznat i na účtu.
*/
function clearingCost(balance, terrain) {
	if (terrain === TERRAIN.forest) return balance?.map.clearForestCost ?? 0;
	if (terrain === TERRAIN.rock) return balance?.map.clearRockCost ?? 0;
	return balance?.map.fillMarshCost ?? 0;
}
/**
* Co bude stát postavení téhle budovy sem, **včetně srovnání parcely**.
*
* Nic nemění. Existuje kvůli §12 kritériu 14: srovnání pod budovou se má
* nabídnout **s cenou předem**, ne až po zaplacení. UI si tohle zavolá při
* najetí myší a hráč vidí, do čeho jde.
*/
function estimatePlacement(world, catalogue, definitionId, x, y, balance) {
	const definition = catalogue.get(definitionId);
	if (!definition) return {
		building: 0,
		levelling: 0,
		total: 0,
		changes: /* @__PURE__ */ new Map()
	};
	const [width, depth] = definition.footprint;
	const changes = definition.construction.allowsSlope ? /* @__PURE__ */ new Map() : planLevelling(world, x, y, width, depth);
	const levelling = changes.size * (balance?.map.terraformCost ?? 0);
	const building = definition.construction.cost;
	return {
		building,
		levelling,
		total: building + levelling,
		changes
	};
}
/**
* Srovnání, které projde i na břehu.
*
* Standardně se rovná na **průměr** rohů, protože to je nejlevnější. U vody to
* ale nejde: průměr může zvednout roh sdílený s vodní dlaždicí a moře by se
* naklonilo. V tom případě se rovná na **nejnižší roh** — pobřežní svah se
* odkope, hladina zůstane, kde byla.
*
* Vyplavalo to při hraní: elektrárna u pobřeží se odmítala postavit s hláškou
* „zvedat dno moře neumíme", i když stála celá na souši.
*/
function planLevelling(world, x, y, width, depth) {
	const averaged = planLevelArea(world.cornerHeight, x, y, width, depth);
	if (checkTerraform(world, averaged).ok) return averaged;
	const side = cornerSideOf(world.cornerHeight);
	let lowest = 15;
	for (let cy = y; cy <= y + depth; cy++) for (let cx = x; cx <= x + width; cx++) {
		if (!cornerInBounds(cx, cy, side)) continue;
		lowest = Math.min(lowest, world.cornerHeight[cornerIndex(cx, cy, side)] ?? 0);
	}
	return planLevelArea(world.cornerHeight, x, y, width, depth, lowest);
}
function placeDefinition(world, catalogue, definitionId, x, y, balance) {
	const definition = catalogue.get(definitionId);
	if (!definition) return reject("error.unknownDefinition", { id: definitionId });
	const plan = estimatePlacement(world, catalogue, definitionId, x, y, balance);
	const fits = checkFootprint(world, definition, x, y, { skipFlatCheck: true });
	if (!fits.ok) return fits;
	const met = checkRequirements(world, catalogue, definition, x, y, presentDefinitions(world));
	if (!met.ok) return met;
	if (plan.changes.size > 0) {
		const allowed = checkTerraform(world, plan.changes);
		if (!allowed.ok) return allowed;
	}
	if (world.economy.funds < plan.total) return reject("error.notEnoughFunds", {
		cost: plan.total,
		funds: world.economy.funds
	});
	world.economy.funds -= plan.total;
	if (plan.changes.size > 0) applyHeightChanges(world, plan.changes);
	placeBuilding(world, definition, x, y);
	return OK;
}
/**
* Vyznačí obdélník zónou. Dlaždice, na které to nejde (voda, silnice, budova),
* se přeskočí — hráč nemá důvod řešit, že mu výběr zasahuje do řeky. Když
* neprojde ani jedna, je to odmítnutí i s důvodem.
*
* `ZONE.none` zónu ruší.
*/
function zoneArea(world, x, y, w, h, zone, balance) {
	const toZone = [];
	let lastReason = "error.zoneNoChange";
	for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
		const tileX = x + dx;
		const tileY = y + dy;
		if (!inBounds(tileX, tileY, world.size)) {
			lastReason = "error.outOfBounds";
			continue;
		}
		const tile = index(tileX, tileY, world.size);
		if (world.layers.terrain[tile] === TERRAIN.water) {
			lastReason = "error.water";
			continue;
		}
		if ((world.layers.road[tile] ?? ROAD.none) !== ROAD.none) {
			lastReason = "error.roadInTheWay";
			continue;
		}
		if (world.layers.buildingId[tile] !== 0) {
			lastReason = "error.occupied";
			continue;
		}
		if (world.layers.zone[tile] === zone) continue;
		toZone.push(tile);
	}
	if (toZone.length === 0) return reject(lastReason);
	const changes = zone === ZONE.none ? /* @__PURE__ */ new Map() : planZoneLevelling(world, x, y, w, h, balance?.map.maxLevelledZoneTiles ?? Infinity);
	const cost = changes.size * (balance?.map.terraformCost ?? 0);
	if (world.economy.funds < cost) return reject("error.notEnoughFunds", {
		cost,
		funds: world.economy.funds
	});
	world.economy.funds -= cost;
	if (changes.size > 0) applyHeightChanges(world, changes);
	for (const tile of toZone) {
		const tileX = tile % world.size;
		setZoneTile(world, tile, zone);
		markTileDirty(world, tileX, (tile - tileX) / world.size);
	}
	return OK;
}
/**
* Co je potřeba srovnat pod právě vyznačenou zónou (T66). Nic nemění.
*
* **Dělá se to při zónování, ne při růstu**, a je za tím geometrie. Sousední
* dlaždice sdílejí rohy, takže dvě sousední rovné dlaždice musí být ve stejné
* výšce; jakmile v okolí něco stojí, terén se nehne. Naměřeno na golden městě:
* ze 61 pokusů srovnat parcelu pod rostoucím domem jich 59 zablokovala budova.
* Ve chvíli zónování je plocha ještě prázdná a srovnat jde.
*
* Rovná se **na průměr**. Dozdění na nejvyšší roh jako u silnice (T61) neprošlo:
* u pobřeží zvedá rohy sdílené s vodní dlaždicí a moře by se naklonilo.
*
* Když celá plocha neprojde, **rozpůlí se a zkouší po částech**. Typicky vadí
* jedna řada u břehu a zbytek čtvrti srovnat jde; bez půlení by pobřežní čtvrť
* zůstala na svahu celá kvůli jedné dlaždici.
*
* Velká plocha se **nesrovnává**: kdo táhne zónu přes celé údolí, nechce
* náhorní plošinu.
*
* Počítá se nad **pracovní kopií výšek**, ne nad světem. Půlení totiž staví
* druhou půlku na tom, co udělala první, a kdyby se přitom sahalo na svět,
* nešlo by cenu spočítat předem — a cenovka by hráči lhala.
*/
function planZoneLevelling(world, x, y, w, h, maxTiles) {
	const working = Uint8Array.from(world.cornerHeight);
	const changes = /* @__PURE__ */ new Map();
	collectZoneLevelling(world, working, changes, x, y, w, h, maxTiles);
	return changes;
}
function collectZoneLevelling(world, working, changes, x, y, w, h, maxTiles) {
	if (w < 1 || h < 1 || w * h > maxTiles) return;
	const step = planLevelArea(working, x, y, w, h);
	if (step.size === 0) return;
	if (reshapeBlocker(world, step) === null) {
		for (const [corner, height] of step) {
			working[corner] = height;
			changes.set(corner, height);
		}
		return;
	}
	if (w === 1 && h === 1) return;
	if (w >= h) {
		const half = Math.floor(w / 2);
		collectZoneLevelling(world, working, changes, x, y, half, h, maxTiles);
		collectZoneLevelling(world, working, changes, x + half, y, w - half, h, maxTiles);
	} else {
		const half = Math.floor(h / 2);
		collectZoneLevelling(world, working, changes, x, y, w, half, maxTiles);
		collectZoneLevelling(world, working, changes, x, y + half, w, h - half, maxTiles);
	}
}
/**
* Položí potrubí (§8 fáze 3).
*
* Na rozdíl od silnice se **neplete s ničím jiným na dlaždici**: potrubí je pod
* zemí, takže smí být pod budovou i pod vozovkou. Právě proto je vlastní vrstva
* a ne další hodnota v `road`.
*/
function buildPipe(world, x, y, balance) {
	if (!inBounds(x, y, world.size)) return reject("error.outOfBounds");
	const tile = index(x, y, world.size);
	if (world.layers.terrain[tile] === TERRAIN.water) return reject("error.pipeOnWater");
	if (world.layers.pipe[tile] === 1) return reject("error.pipeExists");
	if ((world.rubble[tile] ?? 0) !== 0) return reject("error.rubbleInTheWay");
	const cost = balance?.water.pipeCost ?? 0;
	if (world.economy.funds < cost) return reject("error.notEnoughFunds", {
		cost,
		funds: world.economy.funds
	});
	world.economy.funds -= cost;
	world.layers.pipe[tile] = 1;
	markTileDirty(world, x, y);
	markWaterNetworkDirty(world);
	return OK;
}
/**
* Smí se terén na tomhle plánu hnout? Pravidlo je ve `world.ts`, protože se na
* ně ptá i růst zástavby — tady se jen překládá na hlášku pro hráče.
*
* **Budova v cestě terén nezastaví** (rozhodnutí autora, stejné jako u silnic).
* Dřív se to odmítalo hláškou „nejdřív ji zbourej", takže hráč nemohl srovnat
* roh pod křivou silnicí, i když by mu stačilo podezdít dům vedle. Podezdívku
* si budova dokreslí sama, protože renderer kopíruje terén, a `applyHeightChanges`
* ji označí za změněnou, takže se překreslí hned.
*
* Voda pořád ano: zvednutý roh u hladiny by udělal souš pod vodou.
*/
function checkTerraform(world, changes) {
	if (reshapeBlocker(world, changes) === "water") return reject("error.terraformWater");
	return OK;
}
//#endregion
//#region src/sim/mapgen/noise.ts
function createNoiseField(rng, size) {
	const values = new Float32Array(size * size);
	for (let i = 0; i < values.length; i++) values[i] = rng.next();
	return {
		size,
		values
	};
}
/** Hladký přechod 3t² − 2t³ — bez něj jsou na hranách buněk vidět kosočtverce. */
function smooth(t) {
	return t * t * (3 - 2 * t);
}
function at(field, x, y) {
	const wrappedX = (x % field.size + field.size) % field.size;
	const wrappedY = (y % field.size + field.size) % field.size;
	return field.values[wrappedY * field.size + wrappedX] ?? 0;
}
/** Bilineárně interpolovaná hodnota v libovolném bodě mřížky. */
function sampleNoise(field, x, y) {
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const tx = smooth(x - x0);
	const ty = smooth(y - y0);
	const top = at(field, x0, y0) * (1 - tx) + at(field, x0 + 1, y0) * tx;
	const bottom = at(field, x0, y0 + 1) * (1 - tx) + at(field, x0 + 1, y0 + 1) * tx;
	return top * (1 - ty) + bottom * ty;
}
/**
* Fraktální šum: součet oktáv o rostoucí frekvenci a klesající amplitudě.
*
* `roughness` je poměr amplitud sousedních oktáv. Nízká hodnota dá hladké
* pahorky, vysoká rozdrobené pobřeží. Výsledek je normalizovaný na 0–1, aby
* prahy v balancu znamenaly totéž bez ohledu na počet oktáv.
*/
function fbm(field, x, y, octaves, roughness, scale) {
	let total = 0;
	let amplitude = 1;
	let frequency = 1 / scale;
	let maximum = 0;
	for (let octave = 0; octave < octaves; octave++) {
		total += sampleNoise(field, x * frequency, y * frequency) * amplitude;
		maximum += amplitude;
		amplitude *= roughness;
		frequency *= 2;
	}
	return maximum === 0 ? 0 : total / maximum;
}
//#endregion
//#region src/sim/mapgen/index.ts
/**
* Generátor mapy (§2 zadání fáze 3).
*
* Žije pod P1: žádný renderer, žádný DOM, veškerá náhoda z `Rng` (P2). Stejný
* seed proto dá vždycky identickou mapu — hlídá to golden test.
*
* Postup:
* 1. výškové pole z fBm
* 2. voda pod hladinou a **garance souvislé souše** (R7)
* 3. písek kolem vody
* 4. skála nad prahem
* 5. les z druhé šumové vrstvy, jen na trávě
* 6. mokřad v nížinách u vody
* 7. patra v rozích a koryta řek (3b)
*
* Výškové pole na dlaždicích slouží jen k rozmístění terénu. Patra, se kterými
* pak hra pracuje, se vzorkují zvlášť **v rozích** — viz `buildCornerHeights`.
*/
/**
* Velikost mřížky náhodných hodnot, ze které se interpoluje.
*
* **Zůstává v kódu, na rozdíl od měřítek šumu.** Není to ladicí knoflík, ale
* rozlišení zdroje náhody: mřížka se opakuje, takže příliš malá by mapu
* vydláždila kopiemi téhož kopce. Měřítko říká, jak velké mají útvary být;
* tohle jen kolik čísel se na ně natáhne.
*/
var FIELD_SIZE = 64;
function generateTerrain(seed, balance, size = 128) {
	const rng = new Rng(seed);
	const { rockLevel, beachWidth, forestDensity, marshThreshold, octaves, roughness, heightScale, forestScale } = balance.map;
	const heightField = createNoiseField(rng, FIELD_SIZE);
	const forestField = createNoiseField(rng, FIELD_SIZE);
	const cells = size * size;
	const height = new Float32Array(cells);
	const terrain = new Uint8Array(cells);
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) height[index(x, y, size)] = fbm(heightField, x, y, octaves, roughness, heightScale);
	const sorted = Float32Array.from(height).sort();
	const seaHeight = shapeCoastline(terrain, height, sorted, balance);
	const rockHeight = quantileOf(sorted, rockLevel);
	paintBeaches(terrain, beachWidth);
	for (let tile = 0; tile < cells; tile++) if (terrain[tile] === TERRAIN.grass && (height[tile] ?? 0) > rockHeight) terrain[tile] = TERRAIN.rock;
	paintMarshes(terrain, height, seaHeight, marshThreshold);
	const grassTiles = [];
	const forestNoise = new Float32Array(cells);
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
		const tile = index(x, y, size);
		if (terrain[tile] !== TERRAIN.grass) continue;
		forestNoise[tile] = fbm(forestField, x, y, octaves, roughness, forestScale);
		grassTiles.push(tile);
	}
	const forestHeight = quantiles(Float32Array.from(grassTiles, (tile) => forestNoise[tile] ?? 0), [1 - forestDensity])[0] ?? 1;
	for (const tile of grassTiles) if ((forestNoise[tile] ?? 0) >= forestHeight) terrain[tile] = TERRAIN.forest;
	const cornerHeight = buildCornerHeights(heightField, terrain, seaHeight, sorted, balance);
	carveRivers(rng, terrain, cornerHeight, balance);
	return {
		terrain,
		height,
		cornerHeight
	};
}
/**
* Zapíše vygenerovaný terén i patra do světa.
*
* Bere celý `WorldState`, protože přepsat terén znamená zahodit i to, co se
* z terénu počítá. Dokud byl terén konstantou hry, stačily dvě vrstvy.
*/
function applyGeneratedMap(world, map) {
	world.layers.terrain.set(map.terrain);
	world.cornerHeight.set(map.cornerHeight);
	markTerrainChanged(world);
}
/**
* Převede šum na patra v rozích (§7 fáze 3).
*
* Tři kroky, každý má důvod:
* 1. **vzorkuje se v rozích, ne v dlaždicích** — fBm umí libovolné souřadnice,
*    takže se nic neprůměruje a sousední dlaždice na sebe přesně navazují,
* 2. **rohy vody jdou na nulu** — jinak by moře leželo na kopci. Sráží se
*    i rohy sdílené se souší, takže z toho vznikne pobřežní svah zadarmo,
* 3. **`relaxHeights` srovná zbytek** — šum o invariantu nic neví.
*
* Škáluje se od hladiny, ne od nuly: výška 0 znamená „u moře" bez ohledu na to,
* kde zrovna u tohohle seedu hladina vyšla.
*/
function buildCornerHeights(heightField, terrain, seaHeight, sorted, balance) {
	const { maxHeight, heightCurve, octaves, roughness, heightScale } = balance.map;
	const size = sizeOfLayer(terrain);
	const side = cornerSizeOf(size);
	const heights = createCornerHeights(size);
	if (maxHeight <= 0) return heights;
	const peak = quantileOf(sorted, .995);
	const span = Math.max(1e-6, peak - seaHeight);
	for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
		const value = fbm(heightField, x, y, octaves, roughness, heightScale);
		const above = Math.max(0, Math.min(1, (value - seaHeight) / span));
		heights[cornerIndex(x, y, side)] = Math.round(Math.pow(above, heightCurve) * maxHeight);
	}
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
		if (terrain[index(x, y, size)] !== TERRAIN.water) continue;
		for (const [dx, dy] of TILE_CORNERS) heights[cornerIndex(x + dx, y + dy, side)] = 0;
	}
	relaxHeights(heights);
	return heights;
}
/**
* Prokope řeky od pramene k moři (R7).
*
* Řeka teče **po spádnici**: z pramene se pokaždé jde do nejnižšího souseda.
* Když se zasekne v proláklině, koryto se prokope dál k nejbližšímu nižšímu
* místu — jinak by na mapě zůstávaly slepé stružky končící uprostřed pole.
*
* Koryto klesá monotónně a rohy se srovnají, takže voda neteče do kopce.
*
* **Pozor**: řeka rozdělí souš na dva břehy a most je až v T33. Proto je
* `map.rivers` ve vanille zatím nula a tenhle kód čeká na mosty.
*/
function carveRivers(rng, terrain, heights, balance) {
	const { rivers, riverSourceHeight } = balance.map;
	if (rivers <= 0) return;
	const size = sizeOfLayer(terrain);
	const sources = [];
	for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
		const tile = index(x, y, size);
		if (terrain[tile] === TERRAIN.water) continue;
		if (tileBaseHeight(heights, x, y) >= riverSourceHeight) sources.push(tile);
	}
	if (sources.length === 0) return;
	for (let river = 0; river < rivers; river++) {
		const start = sources[rng.int(sources.length)];
		if (start === void 0) continue;
		carveOne(rng, terrain, heights, start);
	}
	drownScraps(terrain, heights, balance.map.scrapIslandTiles);
	relaxHeights(heights);
}
/**
* Zaplaví ostrůvky menší než `map.scrapIslandTiles`, které vznikly korytem řeky.
*
* Nepočítá se největší komponenta, ale **velikost**: řeka může rozdělit mapu
* na dvě velké části a to je v pořádku — přes koryto se dá postavit most.
* Odříznutá trojice dlaždic uprostřed vody most nikdy neuvidí.
*/
function drownScraps(terrain, heights, scrapIslandTiles) {
	const size = sizeOfLayer(terrain);
	const side = cornerSizeOf(size);
	const { componentOf, sizes } = landComponents(terrain);
	for (let tile = 0; tile < terrain.length; tile++) {
		const id = componentOf[tile];
		if (id === void 0 || id < 0) continue;
		if ((sizes[id] ?? 0) >= scrapIslandTiles) continue;
		terrain[tile] = TERRAIN.water;
		const x = tile % size;
		const y = (tile - x) / size;
		for (const [dx, dy] of TILE_CORNERS) heights[cornerIndex(x + dx, y + dy, side)] = 0;
	}
}
/** Jedna řeka od pramene dolů. Vrací délku koryta v dlaždicích. */
function carveOne(rng, terrain, heights, start) {
	const path = [];
	const size = sizeOfLayer(terrain);
	const side = cornerSizeOf(size);
	const visited = /* @__PURE__ */ new Set();
	let tile = start;
	for (let step = 0; step < size * 4; step++) {
		if (visited.has(tile)) break;
		visited.add(tile);
		path.push(tile);
		if (terrain[tile] === TERRAIN.water) break;
		const x = tile % size;
		const y = (tile - x) / size;
		const here = tileBaseHeight(heights, x, y);
		let next = -1;
		let lowest = here;
		for (const [dx, dy] of NEIGHBOURS) {
			const nx = x + dx;
			const ny = y + dy;
			if (!inBounds(nx, ny, size)) continue;
			const at = index(nx, ny, size);
			if (visited.has(at)) continue;
			const level = terrain[at] === TERRAIN.water ? -1 : tileBaseHeight(heights, nx, ny);
			if (level < lowest || level === lowest && next >= 0 && rng.int(2) === 0) {
				lowest = level;
				next = at;
			}
		}
		if (next < 0) {
			next = stepTowardsEdge(size, x, y, visited);
			if (next < 0) break;
		}
		tile = next;
	}
	for (const at of path) {
		terrain[at] = TERRAIN.water;
		const x = at % size;
		const y = (at - x) / size;
		for (const [dx, dy] of TILE_CORNERS) heights[cornerIndex(x + dx, y + dy, side)] = 0;
	}
	return path.length;
}
/** Krok k nejbližšímu okraji mapy. Slouží jen k dokopání řeky z prolákliny. */
function stepTowardsEdge(size, x, y, visited) {
	const toEdge = [
		[
			0,
			-1,
			y
		],
		[
			1,
			0,
			size - 1 - x
		],
		[
			0,
			1,
			size - 1 - y
		],
		[
			-1,
			0,
			x
		]
	];
	let best = -1;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const [dx, dy, distance] of toEdge) {
		const nx = x + dx;
		const ny = y + dy;
		if (!inBounds(nx, ny, size)) continue;
		const at = index(nx, ny, size);
		if (visited.has(at) || distance >= bestDistance) continue;
		best = at;
		bestDistance = distance;
	}
	return best;
}
/** Posuny k rohům dlaždice. Pořadí nehraje roli, jde jen o úplnost. */
var TILE_CORNERS = [
	[0, 0],
	[1, 0],
	[0, 1],
	[1, 1]
];
var NEIGHBOURS = [
	[0, -1],
	[1, 0],
	[0, 1],
	[-1, 0]
];
function isLand(terrain, tile) {
	return terrain[tile] !== TERRAIN.water;
}
/** Hodnota, pod kterou leží `share` podíl už setříděného pole. */
function quantileOf(sorted, share) {
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(share * (sorted.length - 1))))] ?? 0;
}
function quantiles(values, shares) {
	const sorted = Float32Array.from(values).sort();
	return shares.map((share) => quantileOf(sorted, share));
}
/**
* Rozhodne, kudy vede pobřeží, a zaručí souvislou souš (R7).
*
* Ostrovy se **zaplaví**, ne spojí. Původní verze k nim stavěla šíje a na
* členitých mapách z toho byly hřebeny přes celé moře — nahlásil autor. Ztráta
* je malá: medián mapy má 99 % souše v jednom kuse, takže se topí pár ostrůvků,
* které stejně nebylo jak zastavět.
*
* Když by tím ale souš přišla o víc než `minLandShare`, hladina se o kus sníží
* a zkusí se to znovu — méně vody znamená míň ostrovů. Takhle vzniká souvislá
* mapa bez jediného umělého pásu.
*
* Vrací výšku hladiny, kterou nakonec zvolil.
*/
function shapeCoastline(terrain, height, sorted, balance) {
	const { seaLevel, minLandShare } = balance.map;
	let waterShare = seaLevel;
	let seaHeight = quantileOf(sorted, waterShare);
	for (let attempt = 0; attempt < 5; attempt++) {
		seaHeight = quantileOf(sorted, waterShare);
		for (let tile = 0; tile < terrain.length; tile++) terrain[tile] = (height[tile] ?? 0) < seaHeight ? TERRAIN.water : TERRAIN.grass;
		const { componentOf, sizes } = landComponents(terrain);
		if (sizes.length === 0) {
			terrain.fill(TERRAIN.grass);
			return seaHeight;
		}
		let largest = 0;
		let land = 0;
		for (let id = 0; id < sizes.length; id++) {
			land += sizes[id] ?? 0;
			if ((sizes[id] ?? 0) > (sizes[largest] ?? 0)) largest = id;
		}
		if ((sizes[largest] ?? 0) / land >= minLandShare || attempt === 4) {
			for (let tile = 0; tile < terrain.length; tile++) if (isLand(terrain, tile) && componentOf[tile] !== largest) terrain[tile] = TERRAIN.water;
			return seaHeight;
		}
		waterShare *= .8;
	}
	return seaHeight;
}
/** Očísluje souvislé plochy souše. Vrací pole indexů komponent a jejich velikosti. */
function landComponents(terrain) {
	const mapSize = sizeOfLayer(terrain);
	const componentOf = new Int32Array(terrain.length).fill(-1);
	const sizes = [];
	for (let start = 0; start < terrain.length; start++) {
		if (!isLand(terrain, start) || componentOf[start] !== -1) continue;
		const id = sizes.length;
		let size = 0;
		const stack = [start];
		componentOf[start] = id;
		while (stack.length > 0) {
			const tile = stack.pop();
			if (tile === void 0) break;
			size++;
			const x = tile % mapSize;
			const y = (tile - x) / mapSize;
			for (const [dx, dy] of NEIGHBOURS) {
				const nx = x + dx;
				const ny = y + dy;
				if (!inBounds(nx, ny, mapSize)) continue;
				const next = index(nx, ny, mapSize);
				if (!isLand(terrain, next) || componentOf[next] !== -1) continue;
				componentOf[next] = id;
				stack.push(next);
			}
		}
		sizes.push(size);
	}
	return {
		componentOf,
		sizes
	};
}
function paintBeaches(terrain, beachWidth) {
	if (beachWidth <= 0) return;
	const size = sizeOfLayer(terrain);
	const distance = new Uint8Array(terrain.length).fill(255);
	let frontier = [];
	for (let tile = 0; tile < terrain.length; tile++) if (terrain[tile] === TERRAIN.water) {
		distance[tile] = 0;
		frontier.push(tile);
	}
	for (let step = 1; step <= beachWidth && frontier.length > 0; step++) {
		const next = [];
		for (const tile of frontier) {
			const x = tile % size;
			const y = (tile - x) / size;
			for (const [dx, dy] of NEIGHBOURS) {
				const nx = x + dx;
				const ny = y + dy;
				if (!inBounds(nx, ny, size)) continue;
				const at = index(nx, ny, size);
				if (distance[at] !== 255 || terrain[at] !== TERRAIN.grass) continue;
				distance[at] = step;
				terrain[at] = TERRAIN.sand;
				next.push(at);
			}
		}
		frontier = next;
	}
}
/**
* Mokřady: nízko položená místa poblíž vody, která vodou nejsou.
*
* Kreslí se **až za pískem**, takže vznikají za pobřežním pásem, ne místo něj.
*/
function paintMarshes(terrain, height, seaLevel, marshThreshold) {
	const size = sizeOfLayer(terrain);
	const limit = seaLevel + marshThreshold;
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
		const tile = index(x, y, size);
		if (terrain[tile] !== TERRAIN.grass) continue;
		if ((height[tile] ?? 0) > limit) continue;
		let nearWater = false;
		for (const [dx, dy] of NEIGHBOURS) {
			const nx = x + dx;
			const ny = y + dy;
			if (!inBounds(nx, ny, size)) continue;
			const at = index(nx, ny, size);
			if (terrain[at] === TERRAIN.water || terrain[at] === TERRAIN.sand) {
				nearWater = true;
				break;
			}
		}
		if (nearWater) terrain[tile] = TERRAIN.marsh;
	}
}
//#endregion
//#region tools/build-city.ts
/**
* Postaví ukázkové město a uloží ho jako save.
*
*   npx vite build --ssr tools/build-city.ts --outDir tools/.build --logLevel error
*   node tools/.build/build-city.js
*
* Proč přes `vite build --ssr`: skript sahá do `src/sim/` a potřebuje alias
* `@`. Node sám TypeScript s aliasy nespustí a `vite-node` v projektu není.
*
* Sáhne to **jen na simulaci**, ne na renderer — takže tu neplatí P1 obráceně:
* nástroj smí do simulace, simulace nesmí ven.
*
* Výstup: `art/city/showcase.citysave` (zip jako z hry) a `showcase.b64`
* (tentýž save v base64, aby se dal vložit do `localStorage`).
*/
var ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** Hrana mapy. 256 je „velké město" bez toho, aby se tick vlekl jako u 512. */
var SIZE = MAP_SIZES[2] ?? 256;
/** Seed mapy. Vybraný ručně: pevnina s jezerem a pobřežím, ne ostrov. */
var SEED = 20260904;
/** Kolik tiků se nechá běžet. Město roste postupně, tohle je „pokročilé". */
var TICKS = 2e4;
/** Peníze na start. Ukázkové město se nemá zaseknout na rozpočtu. */
var FUNDS = 5e7;
/**
* Vlastní míchačka, ne `world.rng`.
*
* Rozvržení města je **věc nástroje, ne simulace**: kdyby se sáhlo na
* `world.rng`, posunul by se jeho stav a město by se pak vyvíjelo jinak, než
* kdyby ho postavil hráč. Tohle je obyčejný xorshift, stačí to.
*/
function rng(seed) {
	let state = seed >>> 0 || 1;
	return () => {
		state ^= state << 13;
		state >>>= 0;
		state ^= state >>> 17;
		state ^= state << 5;
		state >>>= 0;
		return state / 4294967296;
	};
}
function terrainAt(world, x, y) {
	if (x < 1 || y < 1 || x >= world.size - 1 || y >= world.size - 1) return TERRAIN.water;
	return world.layers.terrain[index(x, y, world.size)] ?? TERRAIN.water;
}
/**
* Dá se sem stavět?
*
* **Tráva a písek, ne „cokoli kromě vody".** Definice mají
* `allowedTerrain: [0, 2]`, takže na skále, v lese ani v mokřadu nevyroste nic
* — první pokus stavěl kamkoli a všech osmnáct služeb padlo na
* `error.terrainNotAllowed`.
*/
function buildable(world, x, y) {
	const terrain = terrainAt(world, x, y);
	return terrain === TERRAIN.grass || terrain === TERRAIN.sand;
}
/**
* Kudy smí vést silnice: všude kromě vody.
*
* Zkoušel jsem ji držet **jen na trávě a písku**, aby se u každé vozovky dalo
* zónovat. Dopadlo to hůř: v terénu poskládaném ze skvrn lesa a skály se
* cesta po pár krocích zasekne a z 2431 dlaždic vozovky zbylo 198 zónovaných
* parcel místo 875. Ulice lesem je lepší než ulice, která nikam nevede.
*/
function roadable(world, x, y) {
	return terrainAt(world, x, y) !== TERRAIN.water;
}
/** Je tu už silnice? */
function hasRoad(world, x, y) {
	if (x < 0 || y < 0 || x >= world.size || y >= world.size) return false;
	return (world.layers.road[index(x, y, world.size)] ?? ROAD.none) !== ROAD.none;
}
/**
* Střed města: těžiště největší souvislé plochy, na které se dá stavět.
*
* První pokus hledal „nejvíc souše" a našel skálu s lesem u okraje mapy —
* silnice tam vedly, ale zónovat ani stavět se nedalo skoro nic a město
* zůstalo na nule. Rozhoduje proto **tráva a písek**, ne „není to voda".
*
* Souvislost se počítá záplavou: dvě oddělené louky po dvou stech dlaždicích
* jsou k ničemu, jedna o čtyřech stech je město.
*/
function findCentre(world) {
	const seen = new Uint8Array(SIZE * SIZE);
	let best = {
		x: SIZE / 2,
		y: SIZE / 2,
		size: -1
	};
	for (let y = 8; y < SIZE - 8; y++) for (let x = 8; x < SIZE - 8; x++) {
		const start = index(x, y, SIZE);
		if (seen[start] === 1 || !buildable(world, x, y)) continue;
		const queue = [start];
		seen[start] = 1;
		let head = 0;
		let sumX = 0;
		let sumY = 0;
		let count = 0;
		while (head < queue.length) {
			const tile = queue[head++];
			const tx = tile % SIZE;
			const ty = Math.floor(tile / SIZE);
			sumX += tx;
			sumY += ty;
			count++;
			for (const [dx, dy] of [
				[1, 0],
				[-1, 0],
				[0, 1],
				[0, -1]
			]) {
				const nx = tx + dx;
				const ny = ty + dy;
				if (nx < 8 || ny < 8 || nx >= SIZE - 8 || ny >= SIZE - 8) continue;
				const next = index(nx, ny, SIZE);
				if (seen[next] === 1 || !buildable(world, nx, ny)) continue;
				seen[next] = 1;
				queue.push(next);
			}
		}
		if (count > best.size) {
			const cx = sumX / count;
			const cy = sumY / count;
			let snapped = queue[0];
			let closest = Infinity;
			for (const tile of queue) {
				const tx = tile % SIZE;
				const ty = Math.floor(tile / SIZE);
				const distance = (tx - cx) ** 2 + (ty - cy) ** 2;
				if (distance < closest) {
					closest = distance;
					snapped = tile;
				}
			}
			best = {
				x: snapped % SIZE,
				y: Math.floor(snapped / SIZE),
				size: count
			};
		}
	}
	console.log(`největší souvislá plocha: ${best.size} dlaždic`);
	return best;
}
/**
* Jedna organická cesta.
*
* Roste po dlaždicích a **občas zahne o jednu**, místo aby jela rovně. Mřížka
* vypadá jako tabulka, kdežto tohle jako město, které rostlo. Když narazí na
* vodu nebo na okraj, skončí — mosty se stavějí zvlášť a záměrně.
*
* Vrací dlaždice, kterými prošla, aby se kolem nich dalo zónovat.
*/
function growRoad(world, start, direction, length, type, random, balance) {
	const laid = [];
	let { x, y } = start;
	let dx = direction.x;
	let dy = direction.y;
	for (let step = 0; step < length; step++) {
		if (!roadable(world, x, y)) break;
		if (!hasRoad(world, x, y)) {
			if (!buildRoad(world, x, y, type, balance).ok) break;
		}
		laid.push({
			x,
			y
		});
		if (random() < .12) {
			const turned = dx === 0 ? {
				x: random() < .5 ? -1 : 1,
				y: 0
			} : {
				x: 0,
				y: random() < .5 ? -1 : 1
			};
			const nx = x + turned.x;
			const ny = y + turned.y;
			if (roadable(world, nx, ny)) {
				if (!hasRoad(world, nx, ny)) buildRoad(world, nx, ny, type, balance);
				laid.push({
					x: nx,
					y: ny
				});
				x = nx;
				y = ny;
			}
		}
		x += dx;
		y += dy;
		if (!roadable(world, x, y)) {
			const side = dx === 0 ? {
				x: random() < .5 ? -1 : 1,
				y: 0
			} : {
				x: 0,
				y: random() < .5 ? -1 : 1
			};
			x = x - dx + side.x;
			y = y - dy + side.y;
			dx = side.x;
			dy = side.y;
			if (!roadable(world, x, y)) break;
		}
	}
	return laid;
}
/** Zónuje pás podél silnice. Kategorie se řídí vzdáleností od centra. */
function zoneAlong(world, road, centre, random, balance) {
	for (const tile of road) {
		const distance = Math.hypot(tile.x - centre.x, tile.y - centre.y);
		const jitter = random() * 12 - 6;
		const zone = distance + jitter < 14 ? ZONE.commercial : distance + jitter < 46 ? ZONE.residential : ZONE.industrial;
		for (const [dx, dy] of [
			[0, -1],
			[0, 1],
			[-1, 0],
			[1, 0]
		]) for (let depth = 1; depth <= 3; depth++) {
			const x = tile.x + dx * depth;
			const y = tile.y + dy * depth;
			if (!buildable(world, x, y)) continue;
			if (hasRoad(world, x, y)) continue;
			zoneArea(world, x, y, 1, 1, zone, balance);
		}
	}
}
function main() {
	const content = new ContentRegistry();
	content.load(createVanillaSource()).then(() => {
		const balance = content.getBalance();
		const world = createWorld(SEED, balance.economy, SIZE);
		applyGeneratedMap(world, generateTerrain(SEED, balance, SIZE));
		world.map = {
			seed: SEED,
			generated: true
		};
		world.economy.funds = FUNDS;
		world.disasters.enabled = false;
		const random = rng(SEED);
		const centre = findCentre(world);
		console.log(`střed města: ${centre.x}, ${centre.y}`);
		const spines = [];
		for (const direction of [
			{
				x: 1,
				y: 0
			},
			{
				x: -1,
				y: 0
			},
			{
				x: 0,
				y: 1
			},
			{
				x: 0,
				y: -1
			}
		]) spines.push(...growRoad(world, centre, direction, 150, ROAD.avenue, random, balance));
		const streets = [];
		for (const tile of spines) {
			if (random() > .45) continue;
			const along = random() < .5 ? {
				x: 1,
				y: 0
			} : {
				x: 0,
				y: 1
			};
			const direction = random() < .5 ? along : {
				x: -along.x,
				y: -along.y
			};
			const length = 14 + Math.floor(random() * 40);
			streets.push(...growRoad(world, tile, direction, length, ROAD.street, random, balance));
		}
		const lanes = [];
		for (const tile of streets) {
			if (random() > .3) continue;
			const along = random() < .5 ? {
				x: 1,
				y: 0
			} : {
				x: 0,
				y: 1
			};
			const direction = random() < .5 ? along : {
				x: -along.x,
				y: -along.y
			};
			lanes.push(...growRoad(world, tile, direction, 8 + Math.floor(random() * 16), ROAD.street, random, balance));
		}
		const roads = [
			...spines,
			...streets,
			...lanes
		];
		console.log(`silnic: ${roads.length} dlaždic`);
		for (const tile of [
			...spines,
			...streets,
			...lanes
		]) buildPipe(world, tile.x, tile.y, balance);
		placeServices(world, content, roads, centre, random, balance);
		zoneAlong(world, roads, centre, random, balance);
		let pipes = 0;
		for (let tile = 0; tile < world.layers.zone.length; tile++) {
			if ((world.layers.zone[tile] ?? 0) === 0) continue;
			const x = tile % world.size;
			if (buildPipe(world, x, (tile - x) / world.size, balance).ok) pipes++;
		}
		console.log(`potrubí pod parcelami: ${pipes}`);
		rebuildTileIndex(world);
		const report = () => {
			let zoned = 0;
			for (const value of world.layers.zone) if (value !== 0) zoned++;
			let watered = 0;
			for (const value of world.waterSupply) if (value === 1) watered++;
			let zonedWatered = 0;
			for (let tile = 0; tile < world.layers.zone.length; tile++) if ((world.layers.zone[tile] ?? 0) !== 0 && world.waterSupply[tile] === 1) zonedWatered++;
			let flat = 0;
			let placeable = 0;
			const reasons = /* @__PURE__ */ new Set();
			const seed = content.get("vanilla:residential_small");
			for (let tile = 0; tile < world.layers.zone.length; tile++) {
				if ((world.layers.zone[tile] ?? 0) !== ZONE.residential) continue;
				const x = tile % world.size;
				const y = (tile - x) / world.size;
				if (isFlatTile(world.cornerHeight, x, y)) flat++;
				if (seed !== void 0) {
					const check = checkFootprint(world, seed, x, y);
					if (check.ok) placeable++;
					else if (placeable === 0 && flat > 0 && reasons.size < 6) reasons.add(check.reason);
				}
			}
			console.log(`  z toho rovných ${flat}, postavitelných ${placeable}`, [...reasons]);
			console.log(`zónovaných ${zoned}, s vodou ${watered}, zónovaných s vodou ${zonedWatered}, poptávka R ${world.demand.residential} C ${world.demand.commercial} I ${world.demand.industrial}, kasa ${Math.round(world.economy.funds)}`);
		};
		report();
		const systems = createDefaultSystems(content, balance);
		const started = Date.now();
		for (let tick = 0; tick < TICKS; tick++) {
			tickWorld(world, systems);
			if ((tick + 1) % 1e4 === 0) console.log(`  tik ${tick + 1}: obyvatel ${totalPopulation(world.buildings)}, budov ${world.buildings.size}`);
		}
		console.log(`simulace ${Math.round((Date.now() - started) / 1e3)} s`);
		report();
		const now = (/* @__PURE__ */ new Date()).toISOString();
		const bytes = serializeSave(world, {
			cityName: "Zdenalcity",
			createdAt: now,
			modifiedAt: now,
			playtimeSeconds: Math.round(TICKS / 4),
			sources: content.getLoadedSources()
		});
		const out = resolve(ROOT, "art", "city");
		mkdirSync(out, { recursive: true });
		writeFileSync(resolve(out, "showcase.citysave"), bytes);
		writeFileSync(resolve(out, "showcase.b64"), Buffer.from(bytes).toString("base64"), "utf8");
		console.log(`hotovo: ${totalPopulation(world.buildings)} obyvatel, ${world.buildings.size} budov, save ${Math.round(bytes.length / 1024)} kB`);
	});
}
/**
* Rozmístí služby podél silnic.
*
* Nehledá optimum — hledá **věrohodnost**: elektrárny na kraji, vodárna
* u břehu, zbytek rovnoměrně po městě s odstupem, aby se dosahy překrývaly.
*/
/** Sousední dlaždice, na kterou se dá postavit budova u silnice. */
var AROUND = (() => {
	const out = [];
	for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
		if (dx === 0 && dy === 0) continue;
		out.push([dx, dy]);
	}
	return out.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
})();
function placeServices(world, content, roads, centre, random, balance) {
	const placed = [];
	/**
	* Odstup se drží **jen proti témuž druhu**, ne proti všem stavbám.
	*
	* Napoprvé to bylo proti všem a šest čerpacích stanic s odstupem 26 zabralo
	* kruhy o ploše skoro celého města — všech osmnáct dalších druhů pak nemělo
	* kam. Dvě hasičárny od sebe daleko dávají smysl, hasičárna daleko od
	* lavičky v parku ne.
	*/
	function free(x, y, keep, id) {
		if (!buildable(world, x, y)) return false;
		return placed.every((other) => other.id === id ? Math.hypot(other.x - x, other.y - y) > keep : Math.hypot(other.x - x, other.y - y) > 2);
	}
	/**
	* Zkusí postavit `count` kusů u náhodných silnic s daným odstupem.
	*
	* Místo se **hledá v okolí silnice**, ne na jedné pevné sousední dlaždici.
	* Budova o půdorysu 2 × 2 se vedle vozovky málokdy trefí napoprvé: první
	* pokus dával `error.roadInTheWay` a ze všech osmnácti druhů se postavilo
	* jen to, co je 1 × 1. Prohledat čtverec kolem je o řád spolehlivější.
	*/
	function spread(definitionId, count, keep) {
		const definition = content.get(definitionId);
		if (definition === void 0) {
			console.log(`  ${definitionId}: v obsahu není`);
			return;
		}
		const [width, depth] = definition.footprint;
		let done = 0;
		let lastReason = "";
		for (let attempt = 0; attempt < roads.length * 3 && done < count; attempt++) {
			const road = roads[Math.floor(random() * roads.length)];
			if (road === void 0) continue;
			for (const [dx, dy] of AROUND) {
				const x = road.x + dx;
				const y = road.y + dy;
				if (!free(x, y, keep, definitionId)) continue;
				let clear = true;
				for (let ty = 0; ty < depth && clear; ty++) for (let tx = 0; tx < width && clear; tx++) if (!buildable(world, x + tx, y + ty)) clear = false;
				else if (hasRoad(world, x + tx, y + ty)) clear = false;
				if (!clear) continue;
				const result = placeDefinition(world, content, definitionId, x, y, balance);
				if (!result.ok) {
					lastReason = result.reason;
					continue;
				}
				placed.push({
					x,
					y,
					id: definitionId
				});
				done++;
				break;
			}
		}
		console.log(`  ${definitionId}: ${done}/${count}${done < count ? ` (${lastReason})` : ""}`);
	}
	const far = roads.filter((tile) => Math.hypot(tile.x - centre.x, tile.y - centre.y) > 40).sort(() => random() - .5);
	for (const definitionId of [
		"vanilla:coal_power_plant",
		"vanilla:coal_power_plant",
		"vanilla:gas_power_plant",
		"vanilla:gas_power_plant",
		"vanilla:nuclear_power_plant"
	]) for (const tile of far) {
		const x = tile.x + 1;
		const y = tile.y + 1;
		if (!free(x, y, 12, definitionId)) continue;
		if (!placeDefinition(world, content, definitionId, x, y, balance).ok) continue;
		placed.push({
			x,
			y,
			id: definitionId
		});
		break;
	}
	spread("vanilla:water_works", 8, 26);
	spread("vanilla:pump_station", 18, 14);
	spread("vanilla:fire_station", 10, 18);
	spread("vanilla:police_small", 10, 18);
	spread("vanilla:clinic", 10, 18);
	spread("vanilla:hospital", 2, 45);
	spread("vanilla:school", 10, 18);
	spread("vanilla:high_school", 3, 40);
	spread("vanilla:university", 1, 60);
	spread("vanilla:park_small", 24, 10);
	spread("vanilla:park_large", 5, 26);
	spread("vanilla:city_park", 3, 34);
	spread("vanilla:plaza", 4, 22);
	spread("vanilla:museum", 1, 60);
	spread("vanilla:theatre", 2, 45);
	spread("vanilla:cinema", 2, 40);
	spread("vanilla:community_centre", 3, 34);
	spread("vanilla:landfill", 2, 50);
}
main();
//#endregion
export {};
