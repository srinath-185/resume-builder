/**
 * Stable string form of an id. The MongoDB connector returns ObjectId
 * instances for properties declared with `mongodb.dataType: 'ObjectId'`
 * (userId, jobListingId, …) while ids from the memory connector and from
 * requests are strings; Map keys and equality checks must use this.
 */
export function idString(id: unknown): string {
  return id === undefined || id === null ? '' : String(id);
}
