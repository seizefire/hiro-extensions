import { BadgeColor, Chapter, ChapterDetails, ChapterProviding, ContentRating, HomePageSectionsProviding, HomeSection, HomeSectionType, MangaProviding, PagedResults, PartialSourceManga, SearchRequest, SearchResultsProviding, SourceInfo, SourceIntents, SourceManga, Tag, TagSection } from "@paperback/types";
import { HomePageResponse, LanguageCodes, ListPagesResponse, ProjectData, ProjectStatuses, TitleSearchResponse } from "./Types";
import { sendGetRequest, validateResponse, validateJSONResponse } from "../Utils";

const BASE_DOMAIN = "https://mangadraft.com";

export const MangaDraftInfo: SourceInfo = {
  version: '1.0.2',
  name: 'MangaDraft',
  description: 'Extension that pulls manga from MangaDraft.',
  author: 'Seize',
  authorWebsite: 'http://github.com/seizefire',
  icon: 'icon.png',
  contentRating: ContentRating.EVERYONE,
  websiteBaseURL: BASE_DOMAIN,
  sourceTags: [
    {
      text: "French",
      type: BadgeColor.GREY
    }
  ],
  intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS
}

export class MangaDraft implements MangaProviding, ChapterProviding, SearchResultsProviding, HomePageSectionsProviding {
  requestManager = App.createRequestManager({requestsPerSecond: 5})

  constructor(public cheerio: cheerio.CheerioAPI) {}

  async getChapters(mangaId: string): Promise<Chapter[]> {
    // load the project data
    const projectData = await this.loadSummaryData(mangaId, "getChapters");
    // create a list of chapters
    var chapters: Chapter[] = [];
    // is the project split into volumes?
    if(projectData.summary.TOME.length != 0){
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
    }
    // is the project not split into volumes
    else if(projectData.summary.ROOT.length != 0){
      let rootChapters = projectData.summary.CHAPTER[projectData.summary.ROOT[0]!.id]!;
      // iterate over each chapter
      for(let i = 0; i < rootChapters.length; ++i){
        let chapter = rootChapters[i]!;
        // add a chapter object
        chapters.push(App.createChapter({
          id: chapter.id.toString(),
          chapNum: chapters.length + 1,
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
    const readerResponse = await sendGetRequest(readerUrl, this.requestManager);
    // validate the response
    const readerBody = validateResponse(readerResponse, `Loading reader page of mid "${mangaId}" cid "${chapterId}" - getChapterDetails`);
    // find the project data
    const projectData = extractProjectData(readerBody, `Loading reader page of mid "${mangaId}" cid "${chapterId}" - getChapterDetails`);
    // load more pages
    const pagesResponse = await sendGetRequest(`${BASE_DOMAIN}/api/reader/listPages?first_page=${projectData.first_page.id}`, this.requestManager, readerUrl);
    const pages: ListPagesResponse = validateJSONResponse(pagesResponse, `Loading extra pages for mid "${mangaId}" cid "${chapterId}" - getChapterDetails`);
    // we need the chapter ID as an int
    const chapterNum = parseInt(chapterId);
    // return the details
    return App.createChapterDetails({
      id: chapterId,
      mangaId: mangaId,
      pages: pages.data.filter(v => v.cat == chapterNum).map(v => v.url + "?size=full&u=0")
    })
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    // get the project data
    const projectData = await this.loadSummaryData(mangaId, "getMangaDetails");
    // get tag section and NSFW rating
    var [tagSection, isNSFW] = createProjectTagSection(projectData);
    // return the manga details
    return App.createSourceManga({
      id: mangaId,
      mangaInfo: App.createMangaInfo({
        image: projectData.project.avatar,
        artist: projectData.project.user.name,
        author: projectData.project.user.name,
        desc: projectData.project.description,
        status: ProjectStatuses[projectData.project.project_status_id]!,
        hentai: isNSFW,
        titles: [projectData.project.name],
        tags: [tagSection],
        banner: projectData.project.background
      })
    })
  }

  getMangaShareUrl(mangaId: string): string {
    return `${BASE_DOMAIN}/manga/${mangaId}`;
  }
  
  async getSearchResults(query: SearchRequest, _metadata: unknown | undefined): Promise<PagedResults> {
    var data: TitleSearchResponse;
    // unfortunately, we cannot search with query and tags together
    if(query.title){
      // make the request and validate
      let response = await sendGetRequest(`${BASE_DOMAIN}/api/search/autocomplete?value=${encodeURIComponent(query.title)}`, this.requestManager, BASE_DOMAIN);
      data = validateJSONResponse(response, `Retrieving search results - getSearchResults`);
    }
    // ... and we can only use one normal tag at a time
    else if(query.includedTags.length != 0){
      let tag = query.includedTags[0]!;
      // make the request
      let response = await sendGetRequest(`${BASE_DOMAIN}/api/catalog/projects?number=16&page=0&order=views&genre=${tag.id}`, this.requestManager, `${BASE_DOMAIN}/catalog/comics/all`);
      data = validateJSONResponse(response, `Retrieving search results - getSearchResults`);
    }
    // unsupported search requests
    else {
      throw new Error(`Unsupported search request: ${JSON.stringify(query)}`);
    }
    // filter the results
    data.data = data.data.filter(v => v.type == "comics");
    // create the manga list
    const mangas: PartialSourceManga[] = data.data.map(result => App.createPartialSourceManga({
      mangaId: result.slug,
      image: result.avatar,
      title: result.name
    }));
    // return the paged results
    return App.createPagedResults({results: mangas});
  }

  async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
    sectionCallback(await this.loadSection("Trending", "order=trending&number=12&thumbnail=true&section=indepolis", HomeSectionType.featured));
    sectionCallback(await this.loadSection("Indepolis", "order=news&number=12&thumbnail=true&section=indepolis", HomeSectionType.singleRowNormal));
    sectionCallback(await this.loadSection("Neoville", "order=news&number=12&thumbnail=true&section=neoville", HomeSectionType.singleRowNormal));
  }

  async getViewMoreItems(_homepageSectionId: string, _metadata: any): Promise<PagedResults> {
    return App.createPagedResults({results: []});
  }

  private async loadSection(name: string, query: string, type: HomeSectionType): Promise<HomeSection> {
    const response = await sendGetRequest(`${BASE_DOMAIN}/api/catalog/projects?${query}`, this.requestManager, BASE_DOMAIN);
    const data: HomePageResponse = validateJSONResponse(response, `Retrieving ${name} section - getHomePageSections`);
    // return the section
    return App.createHomeSection({
      id: name,
      title: name,
      type: type,
      items: data.data.map(v => App.createPartialSourceManga({
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
   * @param parentFunction The name of the parent function (for use in error messages)
   * @returns The project data
   */
  private async loadSummaryData(mangaId: string, parentFunction: string): Promise<ProjectData> {
    // make the request
    const request = await sendGetRequest(`${BASE_DOMAIN}/manga/${mangaId}/summary`, this.requestManager);
    // check for errors
    const data = validateResponse(request, `Loading summary page of id "${mangaId}" - ${parentFunction}`);
    // find the project data
    return extractProjectData(data, `Loading summary page of id "${mangaId}" - ${parentFunction}`);
  }
}

/**
 * Generates a tag section from the project's genres
 * @param project The project
 * @returns The tag section, and whether or not the project is NSFW
 */
function createProjectTagSection(project: ProjectData): [TagSection, boolean] {
  // variables
  var tags: Tag[] = [];
  var isNSFW = false;
  // create tag objects and check if this is NSFW
  for(let genre of project.project.genres){
    if(!isNSFW && genre.name.includes("XXX")){
      isNSFW = true;
    }
    tags.push(App.createTag({id: genre.slug, label: genre.name}));
  }
  // create the tag section
  const tagSection = App.createTagSection({id: "genre", label: "Genres", tags});
  // return
  return [tagSection, isNSFW];
}

/**
 * Tries to extract the project data from the given response body
 * @param body The response body
 * @param purpose The purpose (for use in the error messages)
 * @returns The project data, if found
 */
function extractProjectData(body: string, purpose: string): ProjectData {
  // use regex to find JSON
  const projectDataString = body.match(/(?<=window\.project_data ?= ?){[^\n]+(?=;)/);
  if(projectDataString === null){
    throw new Error(`Could not find "project_data" definition in page body [${purpose}]`);
  }
  // try to parse
  try {
    return JSON.parse(projectDataString[0]);
  }catch(err){
    throw new Error(`Body of "project_data" is not valid JSON - Please report if you see this [${purpose}]`);
  }
}