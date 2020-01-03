import * as express from 'express';

export interface SearchRankModel {
    searchElement: string | string[]; rank: number;
}

export interface CommonSearchModel {
    searchRank?: number;
}

export interface SearchResultModel {
    search: string;
    foundItems: number;
    results: any[];
}

export interface SearchServiceOptions {
    serviceName: string
    cacheTime: number;
    express?: {
        app: express.Application,
        apiPath: string;
    }
}

export interface RawServerData {
    children: RawServerData[],
    _jcrContent: { key: string }
}
export type SearchSynonyms = string[][]