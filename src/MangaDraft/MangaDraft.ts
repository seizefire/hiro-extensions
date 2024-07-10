import { Chapter, ChapterDetails, ChapterProviding, ContentRating, HomePageSectionsProviding, HomeSection, HomeSectionType, MangaProviding, PagedResults, PartialSourceManga, RequestManager, SearchField, SearchRequest, SearchResultsProviding, SourceInfo, SourceIntents, SourceManga, Tag, TagSection } from "@paperback/types";
import { LanguageCodes, MangaSearchResult, ProjectData, ProjectStatuses } from "./Types";

const BASE_DOMAIN = "https://mangadraft.com";

export const MangaDraftInfo: SourceInfo = {
  version: '0.0.1',
  name: 'MangaDraft',
  description: 'Extension that pulls manga from MangaDraft.',
  author: 'Seize',
  authorWebsite: 'http://github.com/seizefire',
  icon: 'icon.png',
  contentRating: ContentRating.EVERYONE,
  websiteBaseURL: BASE_DOMAIN,
  sourceTags: [],
  intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS
}

export class MangaDraft implements MangaProviding, ChapterProviding, SearchResultsProviding, HomePageSectionsProviding {
  numRetries = 5
  requestManager = App.createRequestManager({requestsPerSecond: 5})

  constructor(public cheerio: cheerio.CheerioAPI) {}

  async getChapters(mangaId: string): Promise<Chapter[]> {
    // load the project data
    const projectData = await this.loadSummaryData(mangaId);
    // create a list of chapters
    var chapters: Chapter[] = [];
    // iterate over each tome (volume)
    for(let i = 0; i < projectData.summary.TOME.length; ++i){
      let tome = projectData.summary.TOME[i]!;
      let tomeChapters = projectData.summary.CHAPTER[tome.id]!;
      // iterate over each chapter in the tome
      for(let j = 0; j < tomeChapters.length; ++j){
        let chapter = tomeChapters[j]!;
        // add a chapter object
        chapters.push(App.createChapter({
          id: chapter.id.toString(),
          chapNum: chapters.length + 1,
          volume: i + 1,
          name: chapter.name,
          time: new Date(chapter.published_at),
          langCode: LanguageCodes[projectData.project.language]
        }));
      }
    }
    // return the chapters
    return chapters;
  }

  async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
    // make the request
    const readerUrl = `${BASE_DOMAIN}/reader/${mangaId}/c.${chapterId}`;
    const readerRequest = App.createRequest({
      url: readerUrl,
      method: 'GET',
      headers: {
        'Referer': readerUrl,
        'User-Agent': await this.requestManager.getDefaultUserAgent()
      }
    });
    // get the response
    const readerResponse = await this.requestManager.schedule(readerRequest, this.numRetries);
    // find the project data
    const projectDataString = readerResponse.data!.match(/(?<=window\.project_data ?= ?){[^;]+/);
    if(projectDataString === null){
      throw new Error(`Unable to find "project_data" object in body`);
    }
    const projectData: ProjectData = JSON.parse(projectDataString[0]);
    const firstId = projectData.first_page.id;
    // load more pages
    const pagesUrl = `${BASE_DOMAIN}/api/reader/listPages?first_page=${firstId}`;
    const pagesRequest = App.createRequest({
      url: pagesUrl,
      method: "GET",
      headers: {
        'Referer': readerUrl,
        'User-Agent': await this.requestManager.getDefaultUserAgent()
      }
    });
    const pagesResponse = await this.requestManager.schedule(pagesRequest, this.numRetries);
    const pages: any[] = JSON.parse(pagesResponse.data!).data;
    // get the raw pages
    const chapterNum = parseInt(chapterId);
    // return the details
    return App.createChapterDetails({
      id: chapterId,
      mangaId: mangaId,
      pages: pages.filter(v => v.cat == chapterNum).map(v => v.url)
    })
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    // get the project data
    const projectData = await this.loadSummaryData(mangaId);
    // create list of tags
    var isHentai = false;
    var tagSection = App.createTagSection({
      id: '0',
      label: "Genres",
      tags: projectData.project.genres.map(v => {
        if(!isHentai && v.name.includes("XXX")){
          isHentai = true;
        }
        return App.createTag({id: v.id.toString(), label: v.name});
      })
    })
    // return the manga details
    return App.createSourceManga({
      id: mangaId,
      mangaInfo: App.createMangaInfo({
        image: projectData.project.avatar,
        artist: projectData.project.user.name,
        author: projectData.project.user.name,
        desc: projectData.project.description,
        status: ProjectStatuses[projectData.project.project_status_id]!,
        hentai: isHentai,
        titles: [projectData.project.name],
        tags: [tagSection],
        banner: projectData.project.background
      })
    })
  }

  getMangaShareUrl(mangaId: string): string {
    return `${BASE_DOMAIN}/manga/${mangaId}`;
  }
  
  async getSearchResults(query: SearchRequest, metadata: unknown | undefined): Promise<PagedResults> {
    // make the request
    const url = `${BASE_DOMAIN}/api/search/autocomplete?value=${encodeURIComponent(query.title || (query as any).query || "")}`;
    const request = App.createRequest({
      url: url,
      method: 'GET',
      headers: {
        'Referer': BASE_DOMAIN,
        'User-Agent': await this.requestManager.getDefaultUserAgent()
      }
    });
    // get the response
    const response = await this.requestManager.schedule(request, this.numRetries);
    if(response.status != 200){
      throw new Error(`Failed to retrieve search results`);
    }
    // get the results
    var data: MangaSearchResult[] = JSON.parse(response.data!).data;
    data = data.filter(v => v.type == "comics");
    // create the manga list
    const mangas: PartialSourceManga[] = data.map(v => App.createPartialSourceManga({
      mangaId: v.slug,
      image: v.avatar,
      title: v.name
    }));
    // return the paged results
    return App.createPagedResults({results: mangas});
  }

  async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
    sectionCallback(await this.loadSection("Trending", "order=trending&number=12&thumbnail=true&section=indepolis", HomeSectionType.featured));
    sectionCallback(await this.loadSection("Indepolis", "order=news&number=12&thumbnail=true&section=indepolis", HomeSectionType.singleRowLarge));
    sectionCallback(await this.loadSection("Neoville", "order=news&number=12&thumbnail=true&section=neoville", HomeSectionType.singleRowLarge));
  }

  async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
    return App.createPagedResults({results: []});
  }

  private async loadSection(name: string, query: string, type: HomeSectionType): Promise<HomeSection> {
    // make the request
    const url = `${BASE_DOMAIN}/api/catalog/projects?${query}`;
    const request = App.createRequest({
      url: url,
      method: 'GET',
      headers: {
        'Referer': BASE_DOMAIN,
        'User-Agent': await this.requestManager.getDefaultUserAgent()
      }
    });
    // get the response
    const response = await this.requestManager.schedule(request, this.numRetries);
    if(response.status != 200){
      throw new Error(`Failed to retrieve home page section ${name}`);
    }
    // get the results
    const data: any[] = JSON.parse(response.data!).data;
    // return the section
    return App.createHomeSection({
      id: name,
      title: name,
      type: type,
      items: data.map(v => App.createPartialSourceManga({
        mangaId: v.slug,
        image: v.avatar,
        title: v.title,
        subtitle: v.subtitle
      })),
      containsMoreItems: false
    })
  }

  /**
   * Loads the project data from a manga's summary page
   * @param mangaId The manga's ID
   * @returns The project data
   */
  private async loadSummaryData(mangaId: string): Promise<ProjectData> {
    // make the request
    const url = `${BASE_DOMAIN}/manga/${mangaId}/summary`;
    const request = App.createRequest({
      url: url,
      method: 'GET',
      headers: {
        'Referer': url,
        'User-Agent': await this.requestManager.getDefaultUserAgent()
      }
    });
    // did we find the manga
    const response = await this.requestManager.schedule(request, this.numRetries);
    if(response.status === 404){
      throw new Error(`Manga "${mangaId}" does not exist`);
    }
    // find the project data
    const projectDataString = response.data!.match(/(?<=window\.project_data ?= ?){[^;]+/);
    if(projectDataString === null){
      throw new Error(`Unable to find "project_data" object in body`);
    }
    // return the project data
    return JSON.parse(projectDataString[0]);
  }
}