package expo.modules.netadb;

interface INetadbShizukuService {
    String listPackages(boolean includeUserApps) = 1;
    String controlPackage(String packageName, String action) = 2;
    String inspectPackage(String packageName) = 3;
    void destroy() = 16777114;
}
