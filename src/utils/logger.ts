import chalk from 'chalk';

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    NONE = 4
}

interface LoggerOptions {
    module: string;
    level?: LogLevel;
}

let globalLogLevel: LogLevel = LogLevel.INFO;

export function setGlobalLogLevel(level: LogLevel): void {
    globalLogLevel = level;
}

export class Logger {
    private module: string;
    private level: LogLevel;

    constructor(options: LoggerOptions) {
        this.module = options.module;
        this.level = options.level ?? globalLogLevel;
    }

    private formatModule(): string {
        return `[${this.module}]`;
    }

    debug(message: string, ...args: any[]): void {
        if (this.level <= LogLevel.DEBUG && globalLogLevel <= LogLevel.DEBUG) {
            console.log(chalk.gray(this.formatModule()), message, ...args);
        }
    }

    info(message: string, ...args: any[]): void {
        if (this.level <= LogLevel.INFO && globalLogLevel <= LogLevel.INFO) {
            console.log(chalk.blue(this.formatModule()), message, ...args);
        }
    }

    success(message: string, ...args: any[]): void {
        if (this.level <= LogLevel.INFO && globalLogLevel <= LogLevel.INFO) {
            console.log(chalk.green(this.formatModule()), message, ...args);
        }
    }

    warn(message: string, ...args: any[]): void {
        if (this.level <= LogLevel.WARN && globalLogLevel <= LogLevel.WARN) {
            console.warn(chalk.yellow(this.formatModule()), message, ...args);
        }
    }

    error(message: string, ...args: any[]): void {
        if (this.level <= LogLevel.ERROR && globalLogLevel <= LogLevel.ERROR) {
            console.error(chalk.red(this.formatModule()), message, ...args);
        }
    }
}

export function createLogger(module: string, level?: LogLevel): Logger {
    return new Logger({ module, level });
} 