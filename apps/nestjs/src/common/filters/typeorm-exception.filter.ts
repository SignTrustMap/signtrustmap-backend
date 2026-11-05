import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { QueryFailedError } from 'typeorm';

@Catch(QueryFailedError)
export class TypeOrmExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(TypeOrmExceptionFilter.name);

  catch(exception: QueryFailedError & { code?: string; detail?: string }, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const pgCode = (exception as any)?.code || (exception as any)?.driverError?.code;
    const detail = (exception as any)?.detail || (exception as any)?.driverError?.detail;
    const message = exception.message || 'Database query error';

    this.logger.warn(`Database query failed [code: ${pgCode}]: ${message}`);

    let status = HttpStatus.BAD_REQUEST;
    let clientMessage = 'Bad Request';

    if (pgCode === '23505') {
      // unique_violation
      status = HttpStatus.CONFLICT;
      clientMessage = detail || 'Conflict: Record already exists';
    } else if (pgCode === '23503') {
      // foreign_key_violation
      status = HttpStatus.BAD_REQUEST;
      clientMessage = detail || 'Referenced record does not exist';
    } else if (pgCode === '23502') {
      // not_null_violation
      status = HttpStatus.BAD_REQUEST;
      clientMessage = detail || 'Required field cannot be null';
    } else if (pgCode === '22001') {
      // string_data_right_truncation
      status = HttpStatus.BAD_REQUEST;
      clientMessage = 'Input value exceeds maximum allowed length';
    } else if (pgCode === '22003') {
      // numeric_value_out_of_range
      status = HttpStatus.BAD_REQUEST;
      clientMessage = 'Numeric value is out of acceptable range';
    } else if (pgCode === '22007' || pgCode === '22008') {
      // invalid_datetime_format or datetime_field_overflow
      status = HttpStatus.BAD_REQUEST;
      clientMessage = 'Invalid date or timestamp format';
    } else if (pgCode === '22P02') {
      // invalid_text_representation
      status = HttpStatus.BAD_REQUEST;
      clientMessage = 'Invalid text representation for input data';
    } else if (typeof pgCode === 'string' && pgCode.startsWith('22')) {
      // PostgreSQL Class 22 — Data Exception
      status = HttpStatus.BAD_REQUEST;
      clientMessage = 'Invalid data provided';
    } else {
      // Any other database input constraint/syntax failure
      status = HttpStatus.BAD_REQUEST;
      clientMessage = 'Invalid request parameters';
    }

    response.status(status).json({
      statusCode: status,
      message: clientMessage,
      error: status === HttpStatus.CONFLICT ? 'Conflict' : 'Bad Request',
    });
  }
}
