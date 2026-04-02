package sync

import (
	"fmt"
	"os"
)

// uploadFileToS3 reads a local file and uploads it to S3 via a presigned PUT URL.
func uploadFileToS3(client *Client, localPath, presignedURL string) error {
	data, err := os.ReadFile(localPath)
	if err != nil {
		return fmt.Errorf("read file %s: %w", localPath, err)
	}

	if err := client.PutPresigned(presignedURL, data, "image/jpeg"); err != nil {
		return fmt.Errorf("S3 upload: %w", err)
	}

	// Delete local file after successful upload to conserve disk space
	_ = os.Remove(localPath)
	return nil
}
