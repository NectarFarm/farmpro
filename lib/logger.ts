type LogLevel = 'info' | 'warn' | 'error' | 'debug'

class Logger {
  private format(level: LogLevel, message: string) {
    const timestamp = new Date().toISOString()
    return `[${timestamp}] [${level.toUpperCase()}] ${message}`
  }

  info(message: string, ...args: any[]) {
    console.log(this.format('info', message), ...args)
  }

  warn(message: string, ...args: any[]) {
    console.warn(this.format('warn', message), ...args)
  }

  error(message: string, ...args: any[]) {
    console.error(this.format('error', message), ...args)
  }

  debug(message: string, ...args: any[]) {
    if (process.env.NODE_ENV === 'development') {
      console.debug(this.format('debug', message), ...args)
    }
  }

  /** Returns a function that logs `message` with elapsed ms when called. */
  time(message: string) {
    const start = Date.now()
    return () => {
      const ms = Date.now() - start
      this.debug(`${message} completed`, { ms })
    }
  }
}

export const logger = new Logger()
