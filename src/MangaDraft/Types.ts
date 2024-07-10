// Only documenting what I need because that JSON is huge

type MDChapter = {id: number, name: string, published_at: string}
type MDTome = {id: number}
type MDGenre = {id: number, name: string}

export const LanguageCodes = [
  undefined, "en", undefined, "fr", "it", "es", "de", "pl",
  "pt", "fi", "jp"
]

export const LanguageNames = [
  undefined, "English", undefined, "French", "Italian", "Spanish", "German", "Polish",
  "Portuguese", "Finnish", "Japanese"
]

export const ProjectStatuses = [
  "Ongoing", "Completed", "On Hiatus"
]

export type MangaSearchResult = {
  name: string,
  avatar: string,
  slug: string,
  type: string
}

export type ProjectData = {
  first_page: {
    id: number
  }
  project: {
    avatar: string,
    background: string,
    description: string,
    genres: MDGenre[],
    language: number,
    name: string,
    project_status_id: number,
    project_type: string,
    project_type_id: number,
    user: {
      name: string
    },
    upgraded_at: string
  }
  summary: {
    CHAPTER: {[x: number]: MDChapter[]},
    TOME: MDTome[]
  }
}