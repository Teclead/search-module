import { SearchSynonyms, SearchServiceOptions, SearchRankModel, SearchResultModel, CommonSearchModel, RawServerData } from './models';
import * as express from 'express';
import * as fetch from 'isomorphic-fetch';
import { readFileSync } from 'fs';
import * as path from 'path';

export abstract class AbstractSearchService {
    protected rawData: any[] = [];
    protected synonymsList: SearchSynonyms = [];
    private options: SearchServiceOptions;


    /**
     * push different methods to this empty array
     * to run methods after cache has been updated
     */
    protected serverDataCallBacks: (() => void)[] = [];

    /**
     * a method which returns the url string to fetch data from the external (AEM) server
     */
    abstract getSearchUrl(): string

    /**
     * return an array of SearchRankModels to define the importance of elements to search in
     * @param searchModel defines the structure of the search model
     */
    abstract getSearchCriteria(searchModel: CommonSearchModel): SearchRankModel[]

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
        console.info(`${this.options.serviceName} will update the cache every ${this.options.cacheTime} minutes`)
        setInterval(async () => {
            console.info(`Update Cache of ${this.options.serviceName}`, new Date().toISOString());
            try {
                await this.getServerData();
                for (const fn of this.serverDataCallBacks) {
                    await fn()
                }
            } catch (e) {
                console.error(`${this.options.serviceName} - setUpCacheInterval() =>`, e)
            }
        }, 1000 * 60 * this.options.cacheTime)
    }

    /**
     * async method which will automatically get called
     * by index.ts
     */
    async setUpSearchService() {
        this.setUpDefaultAPI()
        this.setUpCacheInterval()
        this.synonymsList = this.getDefaultSynonyms()
    };

    /**
     * transforms any json object to a CommonSearchModel
     * @param child an json object
     */
    abstract getRawDataElement(child: any): any

    /**
     * creates a default rest endpoint for the search when express and a apiPath is set
     */
    private setUpDefaultAPI() {
        if (this.options.express && this.options.express.app) {
            this.options.express.app.get(`${this.options.express.apiPath}`,
                (req: express.Request, res: express.Response) => {
                    const search = req.query.search;
                    res.send(this.getSearchResult(search));
                });
        } else {
            console.info('No default API will be created')
        }
    }

    /**
     * fetches the raw data from the (AEM) server. 
     * This will be done in intervall depending on the cache config to update the cached data.
     * The fetched data needs  structure like: {pathList:[{...}]}
     */
    async getServerData() {
        let data;
        try {
            data = await (await fetch(this.getSearchUrl())).json();
        } catch (e) {
            console.warn(e)
        }

        const isValidResponse = data && data.pathList && data.pathList.length > 0;
        if (isValidResponse) {
            this.rawData = [];
            data.pathList.forEach((startChild: any) => this.setUpData(startChild));
            console.info(`fetching ${this.options.serviceName} - ${this.getSearchUrl} data done`, data);
        } else {
            console.warn(`fetching ${this.options.serviceName} - ${this.getSearchUrl} data failed!`, data)
        }
    }

    /**
     * takes a string with one or multiple words and return a SearchResultModel
     * @param search a search string with multiple worlds like: 'imprint page'
     */
    getSearchResult(search: string): SearchResultModel {
        if (!search) {
            return { search: 'not-definied', foundItems: 0, results: [] }
        }
        search = search.trim()

        const hasMultipleWords = search.split(' ').length > 1;
        const firstLevelSearch = this.searchForSingleWord(search);

        if (firstLevelSearch.foundItems === 0 && hasMultipleWords) {
            // search for every word
            const secondSearchTerm: string[] = search.split(' ').sort((a, b) => b.length - a.length);
            for (const _search of secondSearchTerm) {
                const secondLevelSearch = this.searchForSingleWord(_search)
                if (secondLevelSearch.foundItems > 0) {
                    console.log("used second", _search)
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
        const results = (search ? this.rawData
            .map((searchElement) => this.getSearchRank(searchElement, synonyms))
            .filter((searchElement) => searchElement.searchRank > 0)
            .sort((a, b) => b.searchRank - a.searchRank)
            : this.rawData)
            || [];

        return { search: synonyms.toString(), foundItems: results.length, results };
    }



    /**
     * filters the raw content child for the needed content keys
     * @param contentChild a content child from the raw data of the (AEM) server api
     * @param pageContentKeys a list of strings which are used as keys in the content child to reduce the raw data
     */
    protected getFilteredContent(contentChild: RawServerData, pageContentKeys: string[]): any {
        const { _jcrContent }: any = contentChild;
        const content: any = {};
        _jcrContent && pageContentKeys.forEach(key => {
            const val = _jcrContent[key];
            if (val) {
                content[key] = val
            }
        })
        return content
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
                synonyms = [...new Set([...synonyms, ...list])]
            }
        })
        return synonyms;
    }

    // TODO rank single words higher: eis => eis > reis
    // TODO add tests
    /**
     * get the searchrank for a search or list of synonyms
     * @param searchModel 
     * @param searchWithSynonyms 
     */
    getSearchRank(searchModel: CommonSearchModel, searchWithSynonyms: string[]): CommonSearchModel {
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
    private isKeyWordFoundInSynonym(searchModel: SearchRankModel, searchWithSynonyms: string[]): boolean {
        if (!searchModel || !searchModel.searchElement) {
            return false;
        }

        let isFound = false;
        const isArray = Array.isArray(searchModel.searchElement)
        // test if one of the synonyms is in the search model
        for (const search of searchWithSynonyms) {
            try {
                const found = isArray ? ((searchModel.searchElement as String[]).findIndex(e => (e || '').toLowerCase().includes(search)) > -1)
                    : (searchModel.searchElement as String).toLowerCase().includes(search);
                if (found) {
                    isFound = true;
                    // no need for more iterations if the search is found
                    break;
                }
            } catch (e) {
                console.warn(`${this.options.serviceName} - foundKeyWordOrSynonym()`, e)
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
            console.warn(`setUpData failed for ${this.options.serviceName}`)
            return
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
        const rawText = readFileSync(path.resolve(__dirname, './lib/synonyms.txt'), 'utf-8').toString()
        const parsedSynonyms = rawText
            .split('\n')
            .map((line: string) => line.split(';')
                .map(synonym => synonym
                    .replace(/\(([^)]+)\)/, '')
                    .replace('  ', ' ')
                    .trim()
                    .toLowerCase()))
        return parsedSynonyms;
    }
}