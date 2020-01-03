import { SearchSynonyms, SearchServiceOptions, SearchRankModel, SearchResultModel, CommonSearchModel, RawServerData } from '../models/Search.model';
export declare abstract class AbstractSearchService {
    protected rawData: any[];
    protected synonymsList: SearchSynonyms;
    private options;
    /**
     * push different methods to this empty array
     * to run methods after cache has been updated
     */
    protected serverDataCallBacks: (() => void)[];
    /**
     * a method which returns the url string to fetch data from the external (AEM) server
     */
    abstract getSearchUrl(): string;
    /**
     * return an array of SearchRankModels to define the importance of elements to search in
     * @param searchModel defines the structure of the search model
     */
    abstract getSearchCriteria(searchModel: CommonSearchModel): SearchRankModel[];
    /**
     *
     * @param options defines the options for the search service
     */
    constructor(options: SearchServiceOptions);
    /**
     * sets up the intetvall for refetching the data from the AEM
     */
    setUpCacheInterval(): void;
    /**
     * async method which will automatically get called
     * by index.ts
     */
    setUpSearchService(): Promise<void>;
    /**
     * transforms any json object to a CommonSearchModel
     * @param child an json object
     */
    abstract getRawDataElement(child: any): CommonSearchModel;
    /**
     * creates a default rest endpoint for the search when express and a apiPath is set
     */
    private setUpDefaultAPI;
    /**
     * fetches the raw data from the (AEM) server.
     * This will be done in intervall depending on the cache config to update the cached data.
     * The fetched data needs  structure like: {pathList:[{...}]}
     */
    getServerData(): Promise<void>;
    /**
     * takes a string with one or multiple words and return a SearchResultModel
     * @param search a search string with multiple worlds like: 'imprint page'
     */
    getSearchResult(search: string): SearchResultModel;
    /**
     * takes a string with one word and return a SearchResultModel
     * @param search a search string with only one word like: 'imprint'
     */
    private searchForSingleWord;
    /**
     * filters the raw content child for the needed content keys
     * @param contentChild a content child from the raw data of the (AEM) server api
     * @param pageContentKeys a list of strings which are used as keys in the content child to reduce the raw data
     */
    protected getFilteredContent(contentChild: RawServerData, pageContentKeys: string[]): any;
    /**
     * looks for synonyms by a given string and reteturns the used string with the list of synonyms
     * @param search a single world string
     */
    getSynonyms(search: string): string[];
    /**
     * get the searchrank for a search or list of synonyms
     * @param searchModel
     * @param searchWithSynonyms
     */
    getSearchRank(searchModel: CommonSearchModel, searchWithSynonyms: string[]): CommonSearchModel;
    /**
     * checks if a query or it's synonym is in a given search model
     * @param searchModel an elements of the search model with a search rank
     * @param search the query of the search from a user
     */
    private isKeyWordFoundInSynonym;
    /**
     *
     * @param data an array of raw data elements from the (AEM) server API
     */
    protected setUpData(data: RawServerData[]): void;
    /**
     * returns a german synonym list
     */
    getDefaultSynonyms(): SearchSynonyms;
}
