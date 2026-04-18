export class BareMuxConnection {
  constructor(workerPath = "") {
    this.workerPath = workerPath;
    this.transport = null;
  }

  async setTransport(transportUrl, options = []) {
    this.transport = { transportUrl, options };
    return this.transport;
  }
}

export default { BareMuxConnection };
