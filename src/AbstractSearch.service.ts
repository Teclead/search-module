import * as express from 'express';
import { readFileSync } from 'fs';
import * as fetch from 'isomorphic-fetch';
import * as path from 'path';
import {
  AEMTypes,
  CommonSearchModel,
  KeywordFound,
  LastCacheUpdate,
  PageContentKeys,
  RawServerData,
  SearchRankModel,
  SearchResultModel,
  SearchServiceOptions,
  SearchSynonyms,
  ServerDataRequestConfig,
  Status,
  SynonymsOfWord,
} from './models';

export abstract class AbstractSearchService {
  protected rawData: any[] = [];
  protected synonymsList: SearchSynonyms = [];
  public options: SearchServiceOptions;
  public lastCacheUpdate: LastCacheUpdate;

  /**
   * This method can be used to build a delay for the fetching
   * in case of having multiple instances of the search service.
   * generate a random number with this code or set to 0 if only on instance is available
   * Math.floor(Math.random() * Math.floor(max));
   * e.g. for up to 5 minutes delay
   * Math.floor(Math.random() * Math.floor(300000));
   *
   */
  abstract instanceDelay: number;

  /**
   * a boolean to enable manual cache trigger. should be specified in the .env file
   */
  abstract enableCacheTrigger: boolean;

  /**
   * push different methods to this empty array
   * to run methods after cache has been updated
   */
  protected serverDataCallBacks: (() => void)[] = [];

  /**
   * a method which returns the url string to fetch data from the external (AEM) server
   */
  abstract getSearchUrl(serverDataRequestConfig?: ServerDataRequestConfig): string | string[];

  /**
   * This method can be used to inject custom headers
   *
   */
  abstract getSearchUrlRequestInits(): RequestInit;

  /**
   * return an array of SearchRankModels to define the importance of elements to search in
   * @param searchModel defines the structure of the search model
   */
  abstract getSearchCriteria(searchModel: CommonSearchModel): SearchRankModel[];

  /**
   *
   * @param options defines the options for the search service
   */
  constructor(options: SearchServiceOptions) {
    this.options = options;
  }

  /**
   * sets up the intetvall for refetching the data from the AEM
   */
  async setUpCacheInterval(): Promise<void> {
    console.info(`${this.options.serviceName} will update the cache every ${this.options.cacheTime} minutes`);
    setInterval(async () => {
      await this.cacheIntervalLifecycle();
    }, 1000 * 60 * this.options.cacheTime);
  }

  async cacheIntervalLifecycle(): Promise<void> {
    await this.cacheIntervalBefore();
    await this.triggerGetServerData();
    await this.cacheIntervalAfter();
  }

  /**
   * async method which will automatically get called
   * by index.ts
   */
  public async setUpSearchService() {
    // for multi instance handling every new instance get's a delay of 5 minutes so fetching doesn't kill the server
    if (this.instanceDelay) {
      console.info(
        `${this.options.serviceName} will start fetching with a delay of ${this.instanceDelay} milliseconds`
      );
      setTimeout(async () => {
        this.setUp();
      }, this.instanceDelay);
    } else {
      console.info(`${this.options.serviceName} will start now.`);
      this.setUp();
    }
  }

  protected async setUp() {
    // call custom methods
    await this.setUpCallbacksBefore();
    //call set up methods
    this.setUpDefaultAPI();
    this.setUpCacheInterval();
    this.synonymsList = this.getDefaultSynonyms();
    // call custom methods
    await this.setUpCallbacksAfter();
  }

  /***
   * this method should be used to call custom methods before setting up the defaultAPI, cache interval and synonym list
   */
  abstract setUpCallbacksBefore(): Promise<void>;

  /***
   * this method should be used to call custom methods after setting up the defaultAPI, cache interval and synonym list
   */
  abstract setUpCallbacksAfter(): Promise<void>;

  abstract cacheIntervalBefore(): Promise<void>;

  abstract cacheIntervalAfter(): Promise<void>;
  /**
   * transforms any json object to a CommonSearchModel
   * @param child an json object
   */
  abstract getRawDataElement(child: any, type: AEMTypes): any;

  /**
   * creates a default rest endpoint for the search when express and a apiPath is set
   */
  private setUpDefaultAPI() {
    if (this.options.express && this.options.express.app) {
      this.options.express.app.get(`${this.options.express.apiPath}`, (req: express.Request, res: express.Response) => {
        const search = req.query.search;
        console.info(`Looking for search result for "${search}" ${new Date().toISOString()}`);
        res.send(this.getSearchResult(search.toString()));
        console.info(`Send response for search result "${search}" ${new Date().toISOString()}`);
      });

      this.options.express.app.get(
        `${this.options.express.apiPath}/updateCache`,
        (req: express.Request, res: express.Response) => {
          console.info(`Trying to trigger manual cache update`);
          let response = 'Manual cache update disabled';
          if (this.enableCacheTrigger) {
            this.cacheIntervalLifecycle();
            response = `Manual cache update triggered`;
          }
          console.info(response);
          res.send(response).status(200);
        }
      );

      this.options.express.app.get(
        `${this.options.express.apiPath}/lastCacheUpdate`,
        (req: express.Request, res: express.Response) => {
          console.info(`Returning last cache update`);
          let response = 'Manual cache update disabled';
          if (this.enableCacheTrigger) {
            response = `Last cache update at: ${this.lastCacheUpdate.time} - Status: ${this.lastCacheUpdate.status}`;
          }
          console.info(response);
          res.send(response).status(200);
        }
      );

      this.options.express.app.get(
        `${this.options.express.apiPath}/synonyms`,
        (req: express.Request, res: express.Response) => {
          const searchWord = req.query.word;
          console.info(`Looking for synonyms of word "${searchWord}"`);
          res.send(this.getSynonymsOfWord(searchWord.toString()));
          console.info(`Send response for synonyms of word "${searchWord}" ${new Date().toISOString()}`);
        }
      );
    } else {
      console.info('No default API will be created');
    }
  }

  /**
   * this method is used to manually trigger the cache update
   */
  async triggerGetServerData() {
    console.info(`Update Cache of ${this.options.serviceName}`, new Date().toISOString());
    try {
      await this.getServerData();
      console.info(`Finish loading cache ${new Date().toISOString()}`);
      for (const fn of this.serverDataCallBacks) {
        await fn();
      }
      console.info(`Finish serverDataCallbacks() ${new Date().toISOString()}`);
    } catch (e) {
      console.error(`${this.options.serviceName} - ${new Date().toISOString()} - triggerGetServerData() =>`, e);
    }
  }
  /**
   * fetches the raw data from the (AEM) server.
   * This will be done in intervall depending on the cache config to update the cached data.
   * The fetched data needs  structure like: {pathList:[{...}]}
   */
  async getServerData(serverDataRequestConfig?: ServerDataRequestConfig) {
    let data: any;
    let responseText: string;
    let response: Response;
    const urls = this.getSearchUrl(serverDataRequestConfig);
    const searchUrls: string[] = Array.isArray(urls) ? (urls as string[]) : [...urls];
    let isValidResponse: boolean = false;
    let searchUrl: string = '';
    for (let urlIndex in searchUrls) {
      const url = searchUrls[urlIndex];
      try {
        console.info(`Start fetching URL nr. ${urlIndex} with ${url} -  ${new Date().toISOString()}`);
        response = await fetch(url, this.getSearchUrlRequestInits());
        responseText = await response.text();
        data = JSON.parse(responseText || '{}');
        console.info(`Done fetching URL nr. ${urlIndex} with ${url} - ${new Date().toISOString()}`);
        searchUrl = url;
      } catch (e) {
        console.warn(
          `Error while fetching URL nr. ${urlIndex} with ${url} -  ${new Date().toISOString()}`,
          responseText,
          e
        );
      }
      isValidResponse = data && data.pathList && data.pathList.length > 0;
      if (isValidResponse) {
        break;
      }
    }

    if (isValidResponse) {
      if (!serverDataRequestConfig || !this.rawData) {
        this.rawData = [];
      }
      data.pathList.forEach((startChild: any) => this.setUpData(startChild, serverDataRequestConfig?.type));
      console.info(`fetching ${this.options.serviceName} - ${searchUrl} data done`);
      this.lastCacheUpdate = {
        time: new Date().toISOString(),
        status: Status.Success,
      };
    } else {
      console.warn(`fetching ${this.options.serviceName} - ${JSON.stringify(urls)} data failed!`, data);
      this.lastCacheUpdate = {
        time: new Date().toISOString(),
        status: Status.Error,
      };
    }
    return;
  }

  /**
   * takes a string with one or multiple words and return a SearchResultModel
   * @param search a search string with multiple worlds like: 'imprint page'
   */
  getSearchResult(search: string): SearchResultModel {
    if (!search) {
      return { search: 'not-definied', foundItems: 0, results: [] };
    }
    search = search.trim().toLowerCase();

    const hasMultipleWords = search.split(' ').length > 1;
    let firstLevelSearch = this.searchForSingleWord(search, false);

    if (firstLevelSearch.foundItems === 0 && hasMultipleWords) {
      // search for every word
      const secondSearchTerm: string[] = search.split(' ').sort((a, b) => b.length - a.length);
      for (const _search of secondSearchTerm) {
        const secondLevelSearch = this.searchForSingleWord(_search, false);
        if (secondLevelSearch.foundItems > 0) {
          console.info('used second', _search);
          return secondLevelSearch;
        }
      }
    }

    if (firstLevelSearch.results.length === 0) {
      firstLevelSearch = this.searchForSingleWord(search, true);
    }

    return firstLevelSearch;
  }

  /**
   * takes a string with one word and return a SearchResultModel
   * @param search a search string with only one word like: 'imprint'
   */
  searchForSingleWord(search: string, partialMatchesForSecondSearch: boolean): SearchResultModel {
    const synonyms = this.getSynonyms(search);
    const results =
      (search
        ? this.rawData
            .map((searchElement) => this.getSearchRank(searchElement, synonyms, search, partialMatchesForSecondSearch))
            .filter((searchElement) => searchElement.searchRank > 0)
            .sort((a, b) => b.searchRank - a.searchRank)
        : this.rawData) || [];

    return { search: synonyms.toString(), foundItems: results.length, results };
  }

  /**
   * filters the raw content child for the needed content keys. Injected manipulation method can be used to change
   * the content
   * @param contentChild a content child from the raw data of the (AEM) server api
   * @param pageContentKeys a list of strings which are used as keys in the content child to reduce the raw data
   */
  protected getFilteredContent(contentChild: RawServerData, pageContentKeys: PageContentKeys[]): any {
    const { _jcrContent }: any = contentChild;
    const content: any = this.getObjectKeys(_jcrContent, pageContentKeys);
    return content;
  }

  protected getObjectKeys(obj: any, pageContentKeys: PageContentKeys[]) {
    let mappedKeys: any = {};
    if (obj) {
      pageContentKeys.forEach((config: PageContentKeys) => {
        const val = obj[config.key];
        if (val) {
          if (Array.isArray(val)) {
            mappedKeys[config.key] = config.manipulation ? val.map((el) => config.manipulation(val)) : val;
          } else if (typeof val === 'object') {
            mappedKeys[config.key] = this.getObjectKeys(val, pageContentKeys);
          } else {
            mappedKeys[config.key] = config.manipulation ? config.manipulation(val) : val;
          }
        }
      });
    }
    return mappedKeys;
  }

  /**
   * looks for synonyms by a given string and reteturns the used string with the list of synonyms
   * @param search a single world string
   */
  getSynonyms(search: string): string[] {
    let synonyms: string[] = [search.toLowerCase()];
    this.synonymsList.forEach((list: string[]) => {
      const isSynonym = list.indexOf(search) > -1;
      // make sure all synonyms are to lowercase first
      if (isSynonym) {
        synonyms = [...new Set([...synonyms, ...list])];
      }
    });
    return synonyms;
  }

  /**
   * takes a string (possibly separated by ,)
   * and returns a json Object with all synonyms for each word
   * @param searchWord
   */
  getSynonymsOfWord(searchWord: string): SynonymsOfWord {
    let results: SynonymsOfWord = {};
    let wordArray: string[] = searchWord.split(',');
    wordArray.forEach((word: string) => {
      const synonyms: string[][] = this.synonymsList.filter((synonymList: string[]) => {
        return synonymList.find((synonym: string) => synonym.toLowerCase() === word.toLowerCase());
      });
      results[word] = synonyms;
    });
    return results;
  }

  // TODO rank single words higher: eis => eis > reis
  // TODO add tests
  /**
   * get the searchrank for a search or list of synonyms
   * @param searchModel
   * @param searchWithSynonyms
   */
  getSearchRank(
    searchModel: CommonSearchModel,
    searchWithSynonyms: string[],
    searchWord: string,
    partialMatch: boolean
  ): CommonSearchModel {
    const criteria = this.getSearchCriteria(searchModel) || [];
    // 0 indicates that there is no search result in that product
    searchModel.searchRank = 0;
    criteria.forEach((el) => {
      const isKeyWordFoundInSynonym = this.isKeyWordFoundInSynonym(el, searchWithSynonyms, searchWord, partialMatch);
      if (isKeyWordFoundInSynonym.found) {
        // multiple hits sum up the search rank
        const elRank = isKeyWordFoundInSynonym.synonym ? el.synonymRank : el.rank;
        searchModel.searchRank = searchModel.searchRank + elRank;
      }
    });
    return searchModel;
  }

  /**
   * checks if a query or it's synonym is in a given search model
   * @param searchModel an elements of the search model with a search rank
   * @param search the query of the search from a user
   */
  isKeyWordFoundInSynonym(
    searchModel: SearchRankModel,
    searchWithSynonyms: string[],
    searchWord: string,
    partialMatch: boolean
  ): KeywordFound {
    if (!searchModel || !searchModel.searchElement) {
      return { found: false, synonym: false };
    }

    let isFound = false;
    const isArray = Array.isArray(searchModel.searchElement);
    // test if one of the synonyms is in the search model
    let isSynonym: boolean = false;
    for (const synonym of searchWithSynonyms) {
      try {
        /*
         * searchModel.fullMatch is relevant for keyword mapping
         * because the injected path is not a synonym, but also
         * doesn't equal the search
         * word
         */
        isSynonym = synonym !== searchWord && !searchModel.fullMatch;
        const fullMatch = partialMatch ? false : isSynonym ? isSynonym : searchModel.fullMatch;
        const found = isArray
          ? (searchModel.searchElement as string[]).findIndex((searchElement) => {
              return this.matchKeywordToSynonym(synonym, searchElement, fullMatch);
            }) > -1
          : this.matchKeywordToSynonym(synonym, searchModel.searchElement as string, fullMatch);
        if (found) {
          isFound = true;
          // no need for more iterations if the search is found
          break;
        }
      } catch (e) {
        console.warn(`${this.options.serviceName} - foundKeyWordOrSynonym()`, e);
      }
    }
    return { found: isFound, synonym: isSynonym };
  }

  matchKeywordToSynonym(synonym: string, searchElement: string, fullMatch: boolean): boolean {
    if (Array.isArray(searchElement)) {
      return (
        searchElement.filter((el) => {
          return this.matchKeywordToSynonym(synonym, el, fullMatch);
        }).length > 0
      );
    }
    if (fullMatch) {
      return (searchElement || '')
        .toLowerCase()
        .split(' ')
        .includes((synonym || '').toLowerCase());
    } else {
      return (searchElement || '').toLowerCase().includes((synonym || '').toLowerCase());
    }
  }

  /**
   *
   * @param data an array of raw data elements from the (AEM) server API
   */
  protected setUpData(data: RawServerData[], type: AEMTypes) {
    if (!data) {
      console.warn(`setUpData failed for ${this.options.serviceName}`);
      return;
    }
    data.forEach((child: RawServerData) => {
      if (child.children) {
        this.rawData.push(this.getRawDataElement(child, type));
        this.setUpData(child.children, type);
      }
    });
  }

  /**
   * returns a german synonym list
   */
  public getDefaultSynonyms(): SearchSynonyms {
    const rawText = readFileSync(path.resolve(__dirname, './lib/synonyms.txt'), 'utf-8').toString();
    const parsedSynonyms = rawText.split('\n').map((line: string) =>
      line
        .split(';')
        .map((synonym) =>
          synonym
            .replace(/\(([^)]+)\)/, '')
            .replace('  ', ' ')
            .trim()
            .toLowerCase()
        )
        .filter((el) => el !== '' && el !== ' ')
    );
    console.info(`Loaded synonym list with ${parsedSynonyms.length} synonyms`);
    return parsedSynonyms;
  }
}
