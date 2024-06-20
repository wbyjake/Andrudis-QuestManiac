//Special thanks to Ereshkigal for some code blocks used to make this possible.
import type { DependencyContainer }     from "tsyringe"

import { IPreAkiLoadMod }               from "@spt-aki/models/external/IPreAkiLoadMod";
import { IPostDBLoadMod }               from "@spt-aki/models/external/IPostDBLoadMod";
import { ILogger }                      from "@spt-aki/models/spt/utils/ILogger"
import { PreAkiModLoader }              from "@spt-aki/loaders/PreAkiModLoader";
import { PostAkiModLoader }             from "@spt-aki/loaders/PostAkiModLoader"
import { DatabaseServer }               from "@spt-aki/servers/DatabaseServer"
import { ImageRouter }                  from "@spt-aki/routers/ImageRouter"
import { ConfigServer }                 from "@spt-aki/servers/ConfigServer"
import { ConfigTypes }                  from "@spt-aki/models/enums/ConfigTypes"
import { ITraderConfig, UpdateTime }    from "@spt-aki/models/spt/config/ITraderConfig"
import { IRagfairConfig }               from "@spt-aki/models/spt/config/IRagfairConfig"
import { HashUtil }                     from "@spt-aki/utils/HashUtil"
import { ImporterUtil }                 from "@spt-aki/utils/ImporterUtil";
import { Traders }                      from "@spt-aki/models/enums/Traders"

import { IAQMDatabase }                 from "../types_aqm/aqm_types"


//trader configs
import * as bashkirBaseJson     from "../db/traders/Bashkir_Temporal_Id/base.json"
import * as colonelBaseJson     from "../db/traders/Colonel_Temporal_Id/base.json"
import * as elderBaseJson       from "../db/traders/Elder_Temporal_Id/base.json"
import * as khokholBaseJson     from "../db/traders/Khokhol_Temporal_Id/base.json"
import * as labratBaseJson      from "../db/traders/LabRat_Temporal_Id/base.json"
import * as wardenBaseJson      from "../db/traders/Warden_Temporal_Id/base.json"

import * as config from "../src/config.json"

"use strict"; // eslint-disable-line @typescript-eslint/no-unused-expressions

// DB au lieu de AKI
class QuestManiac implements IPreAkiLoadMod, IPostDBLoadMod
{
    private mod:    string;
    private logger: ILogger;

    //private enabledTraders: object = {};

    constructor() 
    {
        this.mod = "Andrudis-QuestManiac";
    }

    public preAkiLoad(container: DependencyContainer)
    {
        this.logger = container.resolve<ILogger>("WinstonLogger");

        //Populate enabledTraders object
        /*
        for (const traderName in config.TradersEnabled)
        {
            const traderID: string = this.traderNamesToIDs[traderName];

            this.enabledTraders[traderID] = config.TradersEnabled[traderName];
        }*/

        this.logger.debug(`[${this.mod}] Loading... `)
        this.registerProfileImage(container);
        this.setupTraderUpdateTime(container);
        this.logger.debug(`[${this.mod}] Loaded`)
    }

    // DB AKI
    public postDBLoad(container: DependencyContainer) 
    {
        this.logger.debug(`[${this.mod}] Delayed Loading... `);
        this.logger.info("[AQM] Loading...");

        //Server database variables
        const databaseServer = container.resolve<DatabaseServer>("DatabaseServer")
        const databaseImporter = container.resolve<ImporterUtil>("ImporterUtil");
        const hashUtil = container.resolve<HashUtil>("HashUtil")
        const postAkiModLoader = container.resolve<PostAkiModLoader>("PostAkiModLoader")
        const configServer = container.resolve<ConfigServer>("ConfigServer")
        //const traderConfig = configServer.getConfig<ITraderConfig>(ConfigTypes.TRADER)
        const ragfairConfig = configServer.getConfig<IRagfairConfig>(ConfigTypes.RAGFAIR);
        const unsupportedLocales = ["ch", "cz", "es", "es-mx", "hu", "it", "pl", "po", "sk", "tu"];

        //Get the SPT database and the AQM custom database
        const database = databaseServer.getTables();
        const aqmDb: IAQMDatabase = databaseImporter.loadRecursive(`${postAkiModLoader.getModPath(this.mod)}db/`);
        //const aqmDb = this.getModDatabase(`./${postAkiModLoader.getModPath(this.mod)}db/`);
        const locales = database.locales.global;

        //Add all traders to SPT database
        for (const trader in aqmDb.traders)
        {
            //Skip adding the trader if they are disabled in config:
            //if (!this.enabledTraders[trader]) continue;

            //Remove trader item requirements if configured
            const questAssort = config.AllTradesAvailableFromStart ? 
                { started: {}, success: {}, fail: {} } : 
                aqmDb.traders[trader].questassort;

            database.traders[trader] = {
                base: aqmDb.traders[trader].base,
                assort: aqmDb.traders[trader].assort,
                questassort: questAssort
            };

            Traders[trader] = trader;

            ragfairConfig.traders[trader] = true
        }

        this.logger.info("[AQM] Traders loaded");

        //Add all quests to database
        for (const bundle in aqmDb.QuestBundles)
        {
            this.logger.info("[AQM] Adding Quest Bundle: " + bundle);

            for (const trader in aqmDb.QuestBundles[bundle]) 
            {
                //Skip adding the quest bundle to the trader if they are disabled in config:
                //if (!this.enabledTraders[trader]) continue;

                //quests.json file reference
                const questsFile = aqmDb.QuestBundles[bundle][trader].quests;

                for (const quest of Object.keys(questsFile)) 
                {
                    const questContent = questsFile[quest]

                    //Add trader loyalty rewards if configured
                    if (config.AddTraderLoyaltyReward == true) 
                    {
                        const loyaltyReward = {
                            "value": "0.01",
                            "id": hashUtil.generate(),
                            "type": "TraderStanding",
                            "index": questContent.rewards.Success.length,
                            "target": trader
                        }
                        questContent.rewards.Success.push(loyaltyReward)
                    }

                    //process quest condition configuration options
                    for (const nextCondition of questContent.conditions.AvailableForFinish) 
                    {
                        const nextConditionData = nextCondition

                        if (nextConditionData.type == "Elimination") 
                        {
                            for (const subCondition of nextConditionData.counter.conditions) 
                            {
                                const subConditionData = subCondition;

                                //Replaces raider kill with PMC kills if configured
                                if (config.ReplaceKillCounterForRaidersWithPMCs && subConditionData.conditionType == "Kills") 
                                {
                                    if (subConditionData.target == "Savage") 
                                    {
                                        if (subConditionData.savageRole != null && subConditionData.savageRole[0] == "pmcBot") 
                                        {
                                            subConditionData.target = "AnyPmc"
                                            subConditionData.savageRole = null
                                        }
                                    }
                                }

                                //Remove all map restrictions if configured
                                if (config.RemoveAllMapsRestrictions && subConditionData.conditionType == "Location") 
                                {
                                    subConditionData.target = ["factory4_day", "factory4_night", "bigmap", "Interchange",
                                        "lighthouse", "privatearea", "RezervBase", "Shoreline", "tarkovstreets",
                                        "suburbs", "terminal", "laboratory", "town", "Woods", "Sandbox"]
                                }

                                //Remove all gear restrictions if configured
                                if (config.RemoveAllGearRestrictions && subConditionData.conditionType == "Equipment") 
                                {
                                    subConditionData.equipmentExclusive = []
                                }
                            }
                        }
                    }

                    //Override starting requirements if configured
                    if (config.AllQuestsAvailableFromStart) 
                    {
                        questContent.conditions.AvailableForStart = [{
                            "conditionType": "Level",
                                "compareMethod": ">=",
                                "value": "1",
                                "index": 0,
                                "parentId": "",
                                "id": "AllQuestsAvailable-LevelCondition"
                        }]
                    }

                    //Special thanks to @November75  for this fix
                    this.fixRewardsSuccessItemID(questContent, hashUtil)

                    //Insert quest into database
                    database.templates.quests[questContent._id] = questContent
                }
            }
        }

        this.logger.info("[AQM] Quests loaded")

        //Add all locales to SPT database
        for (const bundle in aqmDb.QuestBundles) 
        {
            for (const trader in aqmDb.QuestBundles[bundle])
            {
                //Skip adding the trader if they are disabled in config:
                //if (!this.enabledTraders[trader]) continue;

                for (const locale in aqmDb.QuestBundles[bundle][trader].locales)
                {
                    //BulkFile import
                    const localeData = aqmDb.QuestBundles[bundle][trader].locales[locale]

                    for (const localeDataEntry of Object.keys(localeData)) 
                    {
                        const subFileContent = localeData[localeDataEntry]
                        locales[locale][localeDataEntry] = subFileContent

                        if (locale == "en")
                        {
                            for (const ul in unsupportedLocales) 
                            {
                                const ulName = unsupportedLocales[ul]
                                locales[ulName][localeDataEntry] = subFileContent
                            }
                        }
                    }

                }
            }
        }

        for (const locale in aqmDb.locales_traders) 
        {
            for (const trader in aqmDb.locales_traders[locale]) 
            {
                //Skip adding the trader if they are disabled in config:
                //if (!this.enabledTraders[trader]) continue;

                const traderLocale = aqmDb.locales_traders[locale][trader]

                for (const entry of Object.keys(traderLocale)) 
                {
                    locales[locale][entry] = traderLocale[entry]
                }
            }
        }

        this.logger.info("[AQM] Locales loaded")

        //Add gamma pouch to set quest if configured
        if (config.ShouldAddGammaContainer)
        {
            this.logger.info("[AQM] Adding Gamma Pouch quest")

            for (const nextQuest in database.templates.quests) 
            {
                const questData = database.templates.quests[nextQuest]
                if (questData._id == config.QuestIdForGammaContainer) 
                {
                    const gammaReward = {
                        "target": "reward_Gamma",
                        "value": "1",
                        "type": "Item",
                        "index": 99,
                        "id": "Gamma_Container_Reward",
                        "items": [
                            {
                                "_id": "reward_Gamma",
                                "_tpl": "5857a8bc2459772bad15db29",
                                "upd": { "StackObjectsCount": 1 }
                            }
                        ]
                    }

                    questData.rewards.Success.push(gammaReward) //type error here because SPT default types are wrong --> Reward extends Item when it shouldn't
                }
            }
        }

        if (config.OverrideTradersDiscounts == true) 
        {
            this.logger.info("[AQM] Overriding Trader Discounts")

            database.traders[bashkirBaseJson._id].base.discount = config.TradersDiscounts.Bashkir
            database.traders[colonelBaseJson._id].base.discount = config.TradersDiscounts.Colonel
            database.traders[elderBaseJson._id].base.discount = config.TradersDiscounts.Elder
            database.traders[khokholBaseJson._id].base.discount = config.TradersDiscounts.Khokhol
            database.traders[labratBaseJson._id].base.discount = config.TradersDiscounts.LabRat
            database.traders[wardenBaseJson._id].base.discount = config.TradersDiscounts.Warden 
            
            /*
            if (this.enabledTraders["Bashkir_Temporal_Id"]) database.traders[bashkirBaseJson._id].base.discount = config.TradersDiscounts.Bashkir
            if (this.enabledTraders["Colonel_Temporal_Id"]) database.traders[colonelBaseJson._id].base.discount = config.TradersDiscounts.Colonel
            if (this.enabledTraders["Elder_Temporal_Id"]) database.traders[elderBaseJson._id].base.discount = config.TradersDiscounts.Elder
            if (this.enabledTraders["Khokhol_Temporal_Id"]) database.traders[khokholBaseJson._id].base.discount = config.TradersDiscounts.Khokhol
            if (this.enabledTraders["LabRat_Temporal_Id"]) database.traders[labratBaseJson._id].base.discount = config.TradersDiscounts.LabRat
            if (this.enabledTraders["Warden_Temporal_Id"]) database.traders[wardenBaseJson._id].base.discount = config.TradersDiscounts.Warden
            */      
        }

        //patch handover issues for 'HK MP5SD Upper receiver'
        for (const itemIndex in database.templates.items) 
        {
            const dbItem = database.templates.items[itemIndex]
            if (dbItem._id === "5926f2e086f7745aae644231") 
            {
                for (const slotIndex in dbItem._props.Slots) 
                {
                    dbItem._props.Slots[slotIndex]._required = false;
                }
            }
        }

        this.logger.debug(`[${this.mod}] Delayed Loaded`)
        this.logger.info("[AQM] Loaded successfully")
    }

    //function of original mod
    private fixRewardsSuccessItemID(questContent, hashUtil: HashUtil): void 
    {
        if (questContent.rewards && questContent.rewards.Success) 
        {
            for (const success of questContent.rewards.Success) 
            {
                if (success.items) 
                {
                    for (const item of success.items) 
                    {
                        const oldID = item._id
                        const newID = hashUtil.generate();

                        item._id = newID

                        // change all same id this items array

                        // find same parentId
                        for (const childItem of success.items) 
                        {
                            if (childItem.parentId && childItem.parentId === oldID) 
                            {
                                childItem.parentId = newID
                            }
                        }

                        // change target
                        if (success.target === oldID) 
                        {
                            success.target = newID
                        }
                    }
                }
            }
        }
    }

    private registerProfileImage(container: DependencyContainer): void 
    {
        // Reference the mod "res" folder
        const preAkiModLoader = container.resolve<PreAkiModLoader>("PreAkiModLoader")
        const imageFilepath = `./${preAkiModLoader.getModPath(this.mod)}res`

        // Register route pointing to the profile picture
        const imageRouter = container.resolve<ImageRouter>("ImageRouter")

        imageRouter.addRoute(bashkirBaseJson.avatar.replace(".jpg", ""), `${imageFilepath}/traders/Bashkir_Temporal_Id.png`)
        imageRouter.addRoute(colonelBaseJson.avatar.replace(".jpg", ""), `${imageFilepath}/traders/Colonel_Temporal_Id.png`)
        imageRouter.addRoute(elderBaseJson.avatar.replace(".jpg", ""), `${imageFilepath}/traders/Elder_Temporal_Id.png`)
        imageRouter.addRoute(khokholBaseJson.avatar.replace(".jpg", ""), `${imageFilepath}/traders/Khokhol_Temporal_Id.png`)
        imageRouter.addRoute(labratBaseJson.avatar.replace(".jpg", ""), `${imageFilepath}/traders/LabRat_Temporal_Id.png`)
        imageRouter.addRoute(wardenBaseJson.avatar.replace(".jpg", ""), `${imageFilepath}/traders/Warden_Temporal_Id.png`)
        
        /*
        if (this.enabledTraders["Bashkir_Temporal_Id"]) imageRouter.addRoute(bashkirBaseJson.avatar.replace(".jpg", ""), `${imageFilepath}/traders/Bashkir_Temporal_Id.png`)
        if (this.enabledTraders["Colonel_Temporal_Id"]) imageRouter.addRoute(colonelBaseJson.avatar.replace(".jpg", ""), `${imageFilepath}/traders/Colonel_Temporal_Id.png`)
        if (this.enabledTraders["Elder_Temporal_Id"]) imageRouter.addRoute(elderBaseJson.avatar.replace(".jpg", ""), `${imageFilepath}/traders/Elder_Temporal_Id.png`)
        if (this.enabledTraders["Khokhol_Temporal_Id"]) imageRouter.addRoute(khokholBaseJson.avatar.replace(".jpg", ""), `${imageFilepath}/traders/Khokhol_Temporal_Id.png`)
        if (this.enabledTraders["LabRat_Temporal_Id"]) imageRouter.addRoute(labratBaseJson.avatar.replace(".jpg", ""), `${imageFilepath}/traders/LabRat_Temporal_Id.png`)
        if (this.enabledTraders["Warden_Temporal_Id"]) imageRouter.addRoute(wardenBaseJson.avatar.replace(".jpg", ""), `${imageFilepath}/traders/Warden_Temporal_Id.png`)
        */
    }

    private setupTraderUpdateTime(container: DependencyContainer): void 
    {
        // Add refresh time in seconds when Config server allows to set configs
        const configServer = container.resolve<ConfigServer>("ConfigServer")
        const traderConfig = configServer.getConfig<ITraderConfig>(ConfigTypes.TRADER)
        const bashkirRefreshConfig: UpdateTime = { traderId: bashkirBaseJson._id, seconds: { min: 1000, max: 6000 } }
        const colonelRefreshConfig: UpdateTime = { traderId: colonelBaseJson._id, seconds: { min: 1000, max: 6000 } }
        const elderRefreshConfig: UpdateTime = { traderId: elderBaseJson._id, seconds: { min: 1000, max: 6000 } }
        const khokholRefreshConfig: UpdateTime = { traderId: khokholBaseJson._id, seconds: { min: 1000, max: 6000 } }
        const labratRefreshConfig: UpdateTime = { traderId: labratBaseJson._id, seconds: { min: 1000, max: 6000 } }
        const wardenRefreshConfig: UpdateTime = { traderId: wardenBaseJson._id, seconds: { min: 1000, max: 6000 } }

        traderConfig.updateTime.push(bashkirRefreshConfig)
        traderConfig.updateTime.push(colonelRefreshConfig)
        traderConfig.updateTime.push(elderRefreshConfig)
        traderConfig.updateTime.push(khokholRefreshConfig)
        traderConfig.updateTime.push(labratRefreshConfig)
        traderConfig.updateTime.push(wardenRefreshConfig)
        
        /*
        if (this.enabledTraders["Bashkir_Temporal_Id"]) traderConfig.updateTime.push(bashkirRefreshConfig)
        if (this.enabledTraders["Colonel_Temporal_Id"]) traderConfig.updateTime.push(colonelRefreshConfig)
        if (this.enabledTraders["Elder_Temporal_Id"]) traderConfig.updateTime.push(elderRefreshConfig)
        if (this.enabledTraders["Khokhol_Temporal_Id"]) traderConfig.updateTime.push(khokholRefreshConfig)
        if (this.enabledTraders["LabRat_Temporal_Id"]) traderConfig.updateTime.push(labratRefreshConfig)
        if (this.enabledTraders["Warden_Temporal_Id"]) traderConfig.updateTime.push(wardenRefreshConfig)
        */
    }

    private traderNamesToIDs = {
        Bashkir: "Bashkir_Temporal_Id",
        Colonel: "Colonel_Temporal_Id",
        Elder: "Elder_Temporal_Id",
        Khokhol: "Khokhol_Temporal_Id",
        LabRat: "LabRat_Temporal_Id",
        Warden: "Warden_Temporal_Id"
    }
    /* eslint-disable */
    private traderIDstoNames = {
        Bashkir_Temporal_Id: "Bashkir",
        Colonel_Temporal_Id: "Colonel",
        Elder_Temporal_Id: "Elder",
        Khokhol_Temporal_Id: "Khokhol",
        LabRat_Temporal_Id: "LabRat",
        Warden_Temporal_Id: "Warden"
    }
    /* eslint-enable */

    //Original database importer function - Not currently used
    /*
    getModDatabase(filepath): IAQMDatabase
    {
        const fs = require("fs");
        const baseNode = {};
        const directories = this.getDirList(filepath);
        const files = fs.readdirSync(filepath);

        // remove all directories from files
        for (const directory of directories) 
        {
            for (const file in files) 
            {
                if (files[file] === directory) 
                {
                    files.splice(file, 1);
                }
            }
        }

        // make sure to remove the file extention
        for (const node in files) 
        {
            const fileName = files[node].split(".").slice(0, -1).join(".");
            baseNode[fileName] = filepath + files[node];
        }

        // deep tree search
        for (const node of directories) 
        {
            baseNode[node] = this.getModDatabase(filepath + node + "/");
        }

        return baseNode;
    }

    //Original directory list function - Not currently used
    getDirList(path) 
    {
        const fs = require("fs");
        return fs.readdirSync(path).filter(function (file) 
        {
            return fs.statSync(path + "/" + file).isDirectory()
        })
    }
    */
}

module.exports = { mod: new QuestManiac() }