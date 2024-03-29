import * as express from 'express';

export interface SearchRankModel {
  searchElement: string | string[];
  fullMatch?: boolean;
  rank: number;
  synonymRank: number;
}

export interface CommonSearchModel {
  searchRank?: number;
  type?: AEMTypes;
}

export interface SearchResultModel {
  search: string;
  foundItems: number;
  results: any[];
}

export interface SearchServiceOptions {
  serviceName: string;
  cacheTime: number;
  express?: {
    app: express.Application | any;
    apiPath: string;
  };
}

export interface RawServerData {
  children: RawServerData[];
  _jcrContent: { key: string };
}
export type SearchSynonyms = string[][];

export enum AEMTypes {
  Page = 'cq:Page',
  Asset = 'dam:Asset',
}

export interface ServerDataRequestConfig {
  path: string;
  type: AEMTypes;
}
export interface SynonymsOfWord {
  [key: string]: string[][];
}

export interface PageContentKeys {
  key: string;
  manipulation?: (val: string | string[]) => string;
}

export interface LastCacheUpdate {
  time: string;
  status: string;
}

export enum Status {
  Success = 'Success',
  Error = 'Error',
}

export interface KeywordFound {
  found: boolean;
  synonym: boolean;
}
