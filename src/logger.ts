import winston from "winston";
import path from "path";
import util from "util";

const isProduction = process.env.NODE_ENV === "production";

// Custom format for better object logging
const customFormat = winston.format.printf(({ timestamp, level, message, stack, ...metadata }) => {
  let msg = `${timestamp} [${level}]: ${message}`;

  // Add stack trace for errors
  if (stack) {
    msg += `\n${stack}`;
  }

  // Filter out Winston's internal symbols and other metadata we don't want
  const filteredMetadata: Record<string, any> = {};
  for (const [key, value] of Object.entries(metadata)) {
    // Skip Winston internal fields
    if (key === 'splat' || key === 'Symbol(level)' || key === 'Symbol(splat)' || key === 'Symbol(message)') {
      continue;
    }
    filteredMetadata[key] = value;
  }

  // Add metadata if present (excluding Winston internals)
  const metaKeys = Object.keys(filteredMetadata);
  if (metaKeys.length > 0) {
    msg += `\n${util.inspect(filteredMetadata, { depth: 3, colors: !isProduction })}`;
  }

  return msg;
});

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  customFormat
);

// Create transports array
const transports: winston.transport[] = [
  // Always log to console
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize({ all: true }),
      winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
      winston.format.errors({ stack: true }),
      customFormat
    )
  })
];

// In production, also log to files
if (isProduction) {
  const logsDir = process.env.LOGS_DIR || path.join(process.cwd(), "logs");

  transports.push(
    // All logs
    new winston.transports.File({
      filename: path.join(logsDir, "combined.log"),
      format: logFormat,
      maxsize: 10485760, // 10MB
      maxFiles: 5
    }),
    // Error logs
    new winston.transports.File({
      filename: path.join(logsDir, "error.log"),
      level: "error",
      format: logFormat,
      maxsize: 10485760, // 10MB
      maxFiles: 5
    })
  );
}

// Create the logger
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  format: logFormat,
  transports
});

// Export convenience functions
export const log = {
  debug: (message: string, metadata?: Record<string, any>) => {
    logger.debug(message, metadata || {});
  },
  info: (message: string, metadata?: Record<string, any>) => {
    logger.info(message, metadata || {});
  },
  warn: (message: string, metadata?: Record<string, any>) => {
    logger.warn(message, metadata || {});
  },
  error: (message: string | Error, metadata?: Record<string, any>) => {
    if (message instanceof Error) {
      logger.error(message.message, { stack: message.stack, ...(metadata || {}) });
    } else {
      logger.error(message, metadata || {});
    }
  }
};
