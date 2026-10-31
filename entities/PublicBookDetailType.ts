import { CopySiblings } from "@/entities/book";

import { PublicBookType } from "./PublicBookType";

export interface PublicBookDetailType extends PublicBookType {
  subtitle: string | null;
  summary: string | null;
  publisherName: string | null;
  publisherDate: string | null;
  pages: number | null;
  minAge: string | null;
  maxAge: string | null;
  relatedBooks: PublicBookType[];
  /** Where this volume sits among the other copies, when there are others. */
  copies?: CopySiblings | null;
}
