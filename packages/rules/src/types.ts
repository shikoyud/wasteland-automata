/** The shape of rules.json. Every number the simulation, the server and the agent guide use lives there. */
export interface Biome {
  code: string;
  id: string;
  name: string;
  walkable: boolean;
  note?: string;
}

export interface SpawnCoast {
  id: string;
  name: string;
  side: string;
}

export interface Gait {
  id: string;
  speedMps: number;
  foodDrainMultiplier: number;
}

export interface Stance {
  combatResponse: string;
  retreatAtHp: number;
  retreatTo: string;
}

export interface RaidWindow {
  opens: string;
  closes: string;
}

export interface Rules {
  rulesVersion: string;
  world: {
    sizeM: number;
    tickHz: number;
    biomeCellM: number;
    navCellM: number;
    maxOnlineAgents: number;
  };
  biomes: Biome[];
  map: {
    minMonuments: number;
    targetMonuments: number;
    monumentNames: string[];
    spawnCoasts: SpawnCoast[];
  };
  movement: {
    defaultGait: string;
    gaits: Gait[];
    arriveWithinM: number;
    entityArriveWithinM: number;
  };
  orders: {
    orderTypes: string[];
    backgroundTypes: string[];
    metaTypes: string[];
  };
  rateLimits: {
    ordersEverySeconds: number;
    ordersBurst: number;
    ordersPerMinute: number;
    talkQuickLines: number;
    talkEverySeconds: number;
    talkPerHour: number;
    equipPerSecond: number;
    otherMetaPerMinute: number;
    observeMaxWaitSeconds: number;
    observeMaxConcurrentLongPolls: number;
    observeNonWaitingPerSecond: number;
  };
  stance: {
    default: Stance;
    retreatAtHpMin: number;
    retreatAtHpMax: number;
    reflexWithinTicks: number;
  };
  survival: {
    hpMax: number;
    inventorySlots: number;
    craftQueueMax: number;
    bandageSeconds: number;
  };
  presence: {
    offlineAfterSeconds: number;
    sleeperMinutes: number;
    sleeperMinutesIfHitBeforeLeaving: number;
    hitBeforeLeavingWindowSeconds: number;
  };
  death: {
    respawnAfterSeconds: number;
    corpseLootableMinutes: number;
    spawnProtectionSeconds: number;
    bedRespawnCooldownMinutes: number;
  };
  combat: {
    minEqualGearTimeToKillSeconds: number;
    minOneTierUpTimeToKillSeconds: number;
    targetLostAfterSeconds: number;
  };
  bases: {
    beaconRadiusM: number;
    beaconMinSpacingM: number;
    maxAuthorized: number;
    maxStructuresPerBeacon: number;
    upkeepPercentOfCostPerDay: number;
    upkeepRisesAboveStructures: number;
    decayHoursByTier: { wood: number; stone: number; metal: number };
    newBaseProtectionHours: number;
    offlineRaidDamageMultiplier: number;
    repairBlockedAfterDamageSeconds: number;
    transferRangeM: number;
  };
  raids: {
    windowsUtc: RaidWindow[];
  };
  season: {
    days: number;
    rolloverWeekdayUtc: string;
    rolloverTimeUtc: string;
    wipes: string[];
    persists: string[];
  };
  economy: {
    currency: string;
    seasonScore: string;
    faucets: string[];
    sinks: string[];
    giveRangeM: number;
  };
  talk: {
    maxChars: number;
    hearingRadiusM: number;
    signMaxChars: number;
    intentMaxChars: number;
    nameMaxChars: number;
    bioMaxChars: number;
    repeatWindowMinutes: number;
    refused: string[];
  };
  attention: {
    everyOrders: number;
    everyActiveMinutes: number;
    muteAfterWrongInARow: number;
    muteMinutes: number;
    unrankedWhenWrongOfLast10: number;
    unrankedTalkEveryMinutes: number;
  };
  purchases: {
    maxOpenRequests: number;
    quoteValidMinutes: number;
    kinds: string[];
    neverSold: string[];
  };
  changes: {
    noticeHours: number;
  };
}
