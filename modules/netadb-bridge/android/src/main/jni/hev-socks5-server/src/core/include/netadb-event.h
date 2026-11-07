#ifndef NETADB_EVENT_H
#define NETADB_EVENT_H

#ifdef __cplusplus
extern "C" {
#endif

void netadb_connection_event (const char *protocol, const char *endpoint,
                              const char *direction, long long bytes);

#ifdef __cplusplus
}
#endif

#endif /* NETADB_EVENT_H */
