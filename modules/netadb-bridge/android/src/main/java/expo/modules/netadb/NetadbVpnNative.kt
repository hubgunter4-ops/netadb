package expo.modules.netadb

/** JNI wrapper for Hev's transparent TCP/UDP tunnel. */
internal object NetadbSocks5TunnelNative {
  init {
    System.loadLibrary("hev-socks5-tunnel")
  }

  external fun TProxyStartService(configPath: String, tunFileDescriptor: Int): Boolean
  external fun TProxyStopService(): Boolean
  external fun TProxyIsRunning(): Boolean
  external fun TProxyGetStats(): LongArray
}

/** JNI wrapper for the loopback SOCKS5 TCP/UDP relay. */
internal object NetadbSocks5ServerNative {
  init {
    System.loadLibrary("hev-socks5-server")
  }

  external fun Socks5StartService(configPath: String): Boolean
  external fun Socks5StopService(): Boolean
  external fun Socks5IsRunning(): Boolean

  /** Called from Hev worker threads with destination metadata only; never packet payload. */
  @JvmStatic
  fun onConnectionEvent(protocol: String, endpoint: String, direction: String, bytes: Long) {
    NetadbVpnService.recordNativeEvent(protocol, endpoint, direction, bytes)
  }
}
