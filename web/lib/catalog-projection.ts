import {
  eyesCoverageLabel,
  EYES_COVERAGE_LABEL_MANIFEST,
} from "../../platform/eyes-coverage.ts";
export interface ProjectedCatalogEntry {
  id: string;
  name: string;
  kind?: string;
  keywords?: readonly string[];
  parentId?: string;
}
const changingIds = [
  ...new Set(EYES_COVERAGE_LABEL_MANIFEST.map((slot) => slot.entity)),
];
/** Only the latest catalog, search, and selection projections are retained. */
export class CatalogProjection<
  T extends ProjectedCatalogEntry = ProjectedCatalogEntry,
> {
  private catalog: readonly T[] | undefined;
  private phase = "";
  private labels = new Map<string, string>();
  private corpus: readonly { entry: T; search: string }[] = [];
  private query: string | undefined;
  private category: string | undefined;
  private selected: string | undefined;
  private matches: readonly T[] = [];
  private follow: readonly T[] = [];
  project(
    catalog: readonly T[],
    epoch: number,
    query: string,
    category: string,
    selected: string,
  ) {
    const names = changingIds.map((id) =>
      eyesCoverageLabel(
        id,
        epoch,
        EYES_COVERAGE_LABEL_MANIFEST.find(
          (slot) => slot.entity === id && slot.phase === "enter",
        )!.from,
      ),
    );
    const phase = JSON.stringify(names);
    const changed = this.catalog !== catalog || this.phase !== phase;
    if (changed) {
      this.catalog = catalog;
      this.phase = phase;
      this.labels = new Map(
        catalog.map((entry) => [
          entry.id,
          eyesCoverageLabel(entry.id, epoch, entry.name),
        ]),
      );
      this.corpus = catalog.map((entry) => ({
        entry,
        search:
          `${entry.name} ${this.labels.get(entry.id)} ${entry.id} ${entry.keywords?.join(" ") ?? ""}`.toLowerCase(),
      }));
    }
    const normalized = query.toLowerCase();
    if (changed || this.query !== normalized || this.category !== category) {
      this.query = normalized;
      this.category = category;
      this.matches = this.corpus
        .filter(
          ({ entry, search }) =>
            (category === "all" ||
              (category === "major"
                ? entry.kind === "star" || entry.kind === "planet"
                : entry.kind === category)) &&
            search.includes(normalized),
        )
        .map((x) => x.entry);
    }
    if (changed || this.selected !== selected) {
      this.selected = selected;
      this.follow = catalog.filter((entry) => entry.id !== selected);
    }
    return { labels: this.labels, matches: this.matches, follow: this.follow };
  }
}
