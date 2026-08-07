/** Shared jest helpers for staff image-access API mocks. */

export function makeUploadImageAccessBatchResponse(uploadIds: number[]) {
  return {
    items: uploadIds.map((upload_id) => ({
      upload_id,
      image_url: "/mock-upload.jpg",
      expires_in: 300,
      error: null as null,
    })),
  };
}

export function mockFetchUploadImageAccessBatch() {
  return jest.fn(async (uploadIds: number[]) => makeUploadImageAccessBatchResponse(uploadIds));
}
