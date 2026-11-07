package expo.modules.netadb;

interface INetadbShizukuService {
    String listPackages(boolean includeUserApps);
    String controlPackage(String packageName, String action);
    String inspectPackage(String packageName);
    void destroy() = 16777114;
}
