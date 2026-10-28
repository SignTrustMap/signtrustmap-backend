async onModuleInit(): Promise<void> {
  if (this.backfillService) {
    this.backfillService
      .backfillMissingAddresses(200)
      .catch((err) =>
        this.logger.warn(`Background address backfill warning: ${err?.message}`),
      );
  }
}