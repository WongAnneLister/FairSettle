import {Controller, Logger, Post, UploadedFile, UseInterceptors} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';

@Controller('uploads')
export class UploadsController {
  private readonly logger = new Logger(UploadsController.name);

  @Post('')
  @UseInterceptors(FileInterceptor('file'))
  uploadFile(@UploadedFile() file: Express.Multer.File) {
    // Logging the whole multer object dumps the file buffer to stdout.
    this.logger.log(`received upload ${file?.originalname} (${file?.size} bytes)`);
  }
}
