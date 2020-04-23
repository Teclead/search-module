import {
  SearchSynonyms,
  SearchServiceOptions,
  SearchRankModel,
  SearchResultModel,
  CommonSearchModel,
  RawServerData,
  SynonymsOfWord,
  PageContentKeys,
} from "./models";
import * as express from "express";
import * as fetch from "isomorphic-fetch";
import { readFileSync } from "fs";
import * as path from "path";

export abstract class AbstractSearchService {
  protected rawData: any[] = [];
  protected synonymsList: SearchSynonyms = [];
  public options: SearchServiceOptions;

  /**
   * This method can be used to build a delay for the fetching
   * in case of having multiple instances of the search service.
   * If there is only one instance, it should be 0
   *
   */
  abstract instanceNumber: number;

  /**
   * This method can be used to build a delay for the fetching
   * in case of having multiple instances of the search service.
   * put the number of minutes which should be the delay
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
  abstract getSearchUrl(): string | string[];

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
  setUpCacheInterval() {
    console.info(
      `${this.options.serviceName} instance ${this.instanceNumber} will update the cache every ${this.options.cacheTime} minutes`
    );
    setInterval(async () => {
      this.triggerGetServerData();
    }, 1000 * 60 * this.options.cacheTime);
  }

  /**
   * async method which will automatically get called
   * by index.ts
   */
  public async setUpSearchService() {
    // for multi instance handling every new instance get's a delay of 5 minutes so fetching doesn't kill the server
    if (this.instanceNumber) {
      console.log(
        `${this.options.serviceName} instance ${
          this.instanceNumber
        } will start fetching with a delay of ${
          this.instanceNumber * this.instanceDelay
        } minutes`
      );
      setTimeout(async () => {
        this.setUp();
      }, 1000 * 60 * (this.instanceDelay * this.instanceNumber));
    } else {
      console.log(
        `${this.options.serviceName} instance ${this.instanceNumber} will start now.`
      );
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
    setTimeout(() => console.log(this.getDefaultSynonyms()), 2000);
    // call custom methods
    this.setUpCallbacksAfter();
  }

  /***
   * this method should be used to call custom methods before setting up the defaultAPI, cache interval and synonym list
   */
  abstract async setUpCallbacksBefore(): Promise<void>;

  /***
   * this method should be used to call custom methods after setting up the defaultAPI, cache interval and synonym list
   */
  abstract async setUpCallbacksAfter(): Promise<void>;
  /**
   * transforms any json object to a CommonSearchModel
   * @param child an json object
   */
  abstract getRawDataElement(child: any): any;

  /**
   * creates a default rest endpoint for the search when express and a apiPath is set
   */
  private setUpDefaultAPI() {
    if (this.options.express && this.options.express.app) {
      this.options.express.app.get(
        `${this.options.express.apiPath}`,
        (req: express.Request, res: express.Response) => {
          const search = req.query.search;
          console.log(
            `Looking for search result for "${search}" ${new Date().toISOString()}`
          );
          res.send(this.getSearchResult(search));
          console.log(
            `Send response for search result "${search}" ${new Date().toISOString()}`
          );
        }
      );

      this.options.express.app.get(
        `${this.options.express.apiPath}/updateCache`,
        (req: express.Request, res: express.Response) => {
          console.log(`Trying to trigger manual cache update`);
          let response = "Manual cache update disabled";
          if (this.enableCacheTrigger) {
            this.triggerGetServerData();
            response = `Manual cache update triggered`;
          }
          console.log(response);
          res.send(response).status(200);
        }
      );

      this.options.express.app.get(
        `${this.options.express.apiPath}/synonyms`,
        (req: express.Request, res: express.Response) => {
          const searchWord = req.query.word;
          console.log(`Looking for synonyms of word "${searchWord}"`);
          res.send(this.getSynonymsOfWord(searchWord));
          console.log(
            `Send response for synonyms of word "${searchWord}" ${new Date().toISOString()}`
          );
        }
      );
    } else {
      console.info("No default API will be created");
    }
  }

  /**
   * this method is used to manually trigger the cache update
   */
  triggerGetServerData() {
    console.info(
      `Update Cache of ${this.options.serviceName}`,
      new Date().toISOString()
    );
    try {
      this.getServerData().then(async () => {
        console.log(`Finish loading cache ${new Date().toISOString()}`);
        for (const fn of this.serverDataCallBacks) {
          await fn();
        }
        console.log(`Finish serverDataCallbacks() ${new Date().toISOString()}`);
      });
    } catch (e) {
      console.error(
        `${
          this.options.serviceName
        } - ${new Date().toISOString()} - triggerGetServerData() =>`,
        e
      );
    }
  }
  /**
   * fetches the raw data from the (AEM) server.
   * This will be done in intervall depending on the cache config to update the cached data.
   * The fetched data needs  structure like: {pathList:[{...}]}
   */
  async getServerData() {
    let data: any;

    const searchUrls: string[] = Array.isArray(this.getSearchUrl())
      ? (this.getSearchUrl() as string[])
      : [...this.getSearchUrl()];

    let isValidResponse: boolean = false;
    let searchUrl: string = "";
    for (let urlIndex in searchUrls) {
      const url = searchUrls[urlIndex];
      try {
        console.log(
          `Start fetching URL nr. ${urlIndex} with ${url} -  ${new Date().toISOString()}`
        );
        data = await (await fetch(url, this.getSearchUrlRequestInits())).json();
        console.log(
          `Done fetching URL nr. ${urlIndex} with ${url} - ${new Date().toISOString()}`
        );
        searchUrl = url;
      } catch (e) {
        console.warn(
          `Error while fetching URL nr. ${urlIndex} with ${url} -  ${new Date().toISOString()}`,
          e
        );
      }
      isValidResponse = data && data.pathList && data.pathList.length > 0;
      if (isValidResponse) {
        break;
      }
    }

    if (isValidResponse) {
      this.rawData = [];
      data.pathList.forEach((startChild: any) => this.setUpData(startChild));
      console.info(
        `fetching ${this.options.serviceName} - ${searchUrl} data done`,
        data
      );
    } else {
      console.warn(
        `fetching ${
          this.options.serviceName
        } - ${this.getSearchUrl()} data failed!`,
        data
      );
    }
  }

  /**
   * takes a string with one or multiple words and return a SearchResultModel
   * @param search a search string with multiple worlds like: 'imprint page'
   */
  getSearchResult(search: string): SearchResultModel {
    if (!search) {
      return { search: "not-definied", foundItems: 0, results: [] };
    }
    search = search.trim().toLowerCase();

    const hasMultipleWords = search.split(" ").length > 1;
    const firstLevelSearch = this.searchForSingleWord(search);

    if (firstLevelSearch.foundItems === 0 && hasMultipleWords) {
      // search for every word
      const secondSearchTerm: string[] = search
        .split(" ")
        .sort((a, b) => b.length - a.length);
      for (const _search of secondSearchTerm) {
        const secondLevelSearch = this.searchForSingleWord(_search);
        if (secondLevelSearch.foundItems > 0) {
          console.log("used second", _search);
          return secondLevelSearch;
        }
      }
    }
    return firstLevelSearch;
  }

  /**
   * takes a string with one word and return a SearchResultModel
   * @param search a search string with only one word like: 'imprint'
   */
  private searchForSingleWord(search: string): SearchResultModel {
    const synonyms = this.getSynonyms(search);
    const results =
      (search
        ? this.rawData
            .map((searchElement) => this.getSearchRank(searchElement, synonyms))
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
  protected getFilteredContent(
    contentChild: RawServerData,
    pageContentKeys: PageContentKeys[]
  ): any {
    const { _jcrContent }: any = contentChild;
    const content: any = {};
    _jcrContent &&
      pageContentKeys.forEach((config) => {
        const val = _jcrContent[config.key];
        if (val) {
          content[config.key] = config.manipulation
            ? config.manipulation(val)
            : val;
        }
      });
    return content;
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
    let wordArray: string[] = searchWord.split(",");
    wordArray.forEach((word: string) => {
      const synonyms: string[][] = this.synonymsList.filter(
        (synonymList: string[]) => {
          return synonymList.find(
            (synonym: string) => synonym.toLowerCase() === word.toLowerCase()
          );
        }
      );
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
    searchWithSynonyms: string[]
  ): CommonSearchModel {
    const criteria = this.getSearchCriteria(searchModel) || [];
    // 0 indicates that there is no search result in that product
    searchModel.searchRank = 0;
    criteria.forEach((el) => {
      if (this.isKeyWordFoundInSynonym(el, searchWithSynonyms)) {
        // multiple hits sum up the search rank
        searchModel.searchRank = searchModel.searchRank + el.rank;
      }
    });
    return searchModel;
  }

  /**
   * checks if a query or it's synonym is in a given search model
   * @param searchModel an elements of the search model with a search rank
   * @param search the query of the search from a user
   */
  private isKeyWordFoundInSynonym(
    searchModel: SearchRankModel,
    searchWithSynonyms: string[]
  ): boolean {
    if (!searchModel || !searchModel.searchElement) {
      return false;
    }

    let isFound = false;
    const isArray = Array.isArray(searchModel.searchElement);
    // test if one of the synonyms is in the search model
    for (const search of searchWithSynonyms) {
      try {
        const found = isArray
          ? (searchModel.searchElement as String[]).findIndex((e) =>
              (e || "").toLowerCase().includes(search)
            ) > -1
          : (searchModel.searchElement as String)
              .toLowerCase()
              .includes(search);
        if (found) {
          isFound = true;
          // no need for more iterations if the search is found
          break;
        }
      } catch (e) {
        console.warn(
          `${this.options.serviceName} - foundKeyWordOrSynonym()`,
          e
        );
      }
    }

    return isFound;
  }

  /**
   *
   * @param data an array of raw data elements from the (AEM) server API
   */
  protected setUpData(data: RawServerData[]) {
    if (!data) {
      console.warn(`setUpData failed for ${this.options.serviceName}`);
      return;
    }
    data.forEach((child: RawServerData) => {
      if (child.children) {
        this.rawData.push(this.getRawDataElement(child));
        this.setUpData(child.children);
      }
    });
  }

  /**
   * returns a german synonym list
   */
  public getDefaultSynonyms(): SearchSynonyms {
    const rawText = readFileSync(
      path.resolve(__dirname, "./lib/synonyms.txt"),
      "utf-8"
    ).toString();
    const parsedSynonyms = rawText.split("\n").map((line: string) =>
      line.split(";").map((synonym) =>
        synonym
          .replace(/\(([^)]+)\)/, "")
          .replace("  ", " ")
          .trim()
          .toLowerCase()
      )
    );
    return parsedSynonyms;
  }
}
